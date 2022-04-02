declare class AudioWorkletProcessor {
    port: MessagePort;
    constructor(options: any);
};
declare function registerProcessor(..._: any[]): void;
declare var currentTime: number;
declare var sampleRate: number;

type Instrument = any;
type Operator = any;
type AwConstructorArgs = any;

/*
the audio worklet for mixer.ts. see that file for most of the details.

typescript doesn't have the right definitions for audio worklets built-in, so we need to
declare them explicitly.

unfortunately, require.js doesn't support audio worklets, so i couldn't find any reasonable way
to share a "header" between mixer.ts and this file. instead, we fall back to dynamic typing
for types like Instrument or AwConstructorArgs. a few of the constants below need to be kept
in-sync between this file and mixer.ts, by hand.

todo?: to avoid artefacts in the higher registers, ideally we would lightly oversample (by a
factor of two?), then downsample the output. i think (?) it's fine to just downsample by
averaging neighbouring samples, rather than using something like windowed sinc. however,
oversampling would still carry significant performance cost and complexity cost.

bug: at least on chrome (plausibly also firefox?), each VoiceProcessor will leak after it's
finished, using up about 3kb of memory and a tiny fraction of the cpu. chrome reports about 5%
"render capacity" usage for about 1500 leaked voices; this causes noticeable midi desync after
several minutes of use. can be reasonably confident that the culprit is a known bug in chrome, 
rather than anything we're doing:
    
    https://bugs.chromium.org/p/chromium/issues/detail?id=1298955
*/

//caution: if you change these, also change the definition in mixer.ts
const MODULATION_WEIGHT = 2.8;
const PING_INTERVAL_SECONDS = 0.5;

const PING_EXPECTED_SAMPLES = sampleRate * PING_INTERVAL_SECONDS;

//the minimum amount of time, in seconds, over which any sharp transition should
//be smoothed out. this helps to avoid clicks and pops
const MIN_TRANSITION_TIME = 0.03;

const MAX_VOLUME = Math.pow(0.5, 5); //-15dbFS

const OPERATOR_NAMES = ["a", "b", "c", "d"];

class VoiceProcessor extends AudioWorkletProcessor {
    instrument: Instrument;
    instrumentOperators: Operator[];

    note: number;
    velocity: number;
    modWheel: number;

    /*
    all measured in seconds, in the AudioContext.currentTime coordinate space. `fadeInTime` may
    lie in the future; it refers to the start of the crossfade-in, MIN_TRANSITION_TIME in length.

    we previously scheduled such events with per-sample precision using an AudioParam and
    setValueAtTime, but if we don't have sample-accurate crossfades, it really isn't worth
    the trouble.

    note that currentTime has low precision: 2ms on firefox, or 100ms with resistFingerprinting.
    resistFingerprinting seems like a pretty uncommon setting, so hopefully we'll be fine...?
    */

    noteDownTime: number;
    noteUpTime: number | null;

    fadeInTime: number;
    fadeOutTime: number | null;

    envelopes: Envelope[];

    /*
    force-stopping and cross-fading both share a special gain level, multiplied onto the
    final output
    */

    fadeGain = 0;
    fadeRate = MAX_VOLUME / (MIN_TRANSITION_TIME * sampleRate);

    /*
    if the audio thread receives more work than it can handle, it will stall, emit noise, and
    potentially starve the main thread. to make this (slightly) more recoverable, we try to detect
    when the worker thread or main thread are stalled, in which case we kill ongoing voices.

    the main thread sends a "ping" message to all voices twice per second. if a voice has produced
    twice as many samples as expected before receiving another ping, the main thread seems to
    be stalled, so the voice stops. if it's produced half as many samples as expected between two
    pings, the audio thread seems to be stalled, so the voice stops.

    todo?: ideally we'd do something about the noise; it's currently forcing us to reduce
    MAX_POLYPHONY to a brutally low level. i think the only solution would be to improve the
    performance of the audio worklet (which would take a lot of engineering effort...)
    */

    samplesSinceLastPing: number | null = null;
    audioStarvedPings = 0;

    constructor(options: { processorOptions: AwConstructorArgs }) {
        super(options);

        /*
        unpack the actual constructor arguments...
        */

        let args = options.processorOptions;

        this.instrument = args.instrument;
        this.instrumentOperators = OPERATOR_NAMES.map((opName) => this.instrument[opName]);

        this.note = args.note;
        this.velocity = args.velocity;
        this.modWheel = args.modWheel;

        this.noteDownTime = args.noteDownTime || currentTime;
        this.noteUpTime = args.noteUpTime;
        this.fadeInTime = args.fadeInTime || currentTime;
        this.fadeOutTime = null;

        /*
        initialise each operator's envelope
        */

        this.envelopes = [];

        for (let opName of OPERATOR_NAMES) {
            this.envelopes.push(new Envelope(
                this.instrument[opName].envelope,
                this.instrument[opName].enabled,
                this.noteDownTime,
                this.noteUpTime,
                currentTime,
            ));
        }

        /*
        calculate the natural frequency, and therefore the phase increment, for each
        operator and the lfo
        */

        for (let i = 0; i < 4; i++) {
            let opName = OPERATOR_NAMES[i];
            let op = this.instrument[opName];

            let opFrequency = args.frequency * op.frequencyRatio + op.frequencyOffsetHz;

            let opSamplesPerOsc = sampleRate / opFrequency;
            this.naturalAngleIncs[i] = (Math.PI * 2) / opSamplesPerOsc;
        }

        let lfoSamplesPerOsc = sampleRate / this.instrument.lfoFrequencyHz;
        this.lfoAngleInc = (Math.PI * 2) / lfoSamplesPerOsc;

        this.lfoTimeSeconds = currentTime - this.noteDownTime;
        this.advanceLfoBy(0); //just for the side-effect of populating this.lfo
    
        /*
        caution: for whatever reason, MessagePort requires you to explicitly enable the flow
        of events (by calling start()) when using addEventListener, but not when assigning to
        the `onmessage` property
        */

        this.port.addEventListener("message", ({ data }) => {
            if (data.messageType === "release") {
                this.noteUpTime = data.noteUpTime;
                for (let envelope of this.envelopes) {
                    envelope.release(data.noteUpTime);
                }
            }

            if (data.messageType === "forceStop") {
                this.fadeOutTime = data.forceStopTime;
            }

            if (data.messageType === "ping") {
                if (
                    this.samplesSinceLastPing !== null
                    && this.samplesSinceLastPing < PING_EXPECTED_SAMPLES * 0.5
                ) {
                    this.audioStarvedPings += 1;
                } else {
                    this.audioStarvedPings = 0;
                }

                this.samplesSinceLastPing = 0;
            }
        });

        this.port.start();

        /*
        the only way to precisely seek the worklet forwards to some future moment is to generate
        every intermediate sample. (if the synth were simpler, it might be possible to seek to
        any destination time in O(1) - but operator feedback makes that task drastically more
        challenging than it otherwise would be.)

        precise seeking would produce glitch-free crossfades while doing things like moving the
        mod wheel, but unfortunately it's much too costly (introducing hundreds of milliseconds
        of latency after just a couple of seconds of sustain). can't see any option other than
        disabling it. crossfades glitch a little bit, but it's tolerable.
        */

        /*for (let i = 0; i < samplesToSkip; i++) {
            this.advanceOperators();
        }*/
    }

    /*
    the operators
    */

    naturalAngles = [0, 0, 0, 0];
    naturalAngleIncs = [0, 0, 0, 0];

    //"pre-envelope" and "post-envelope" operator outputs
    lastOpOutputsPre = [0, 0, 0, 0];
    lastOpOutputsPost = [0, 0, 0, 0];

    //scratch buffers, to avoid allocation
    opScratchPre = [0, 0, 0, 0];
    opScratchPost = [0, 0, 0, 0];

    advanceOperators(lfo: number, envelopeGains: number[]): number {
        /*
        generate each operator's signal
        */

        for (let i = 0; i < 4; i++) {
            let opNameI = OPERATOR_NAMES[i];
            let operatorI = this.instrumentOperators[i];

            if (operatorI.enabled) {
                let modulatedAngle = this.naturalAngles[i];
                this.naturalAngles[i] += this.naturalAngleIncs[i];

                for (let j = 0; j < 4; j++) {
                    /*
                    when an operator modulates itself, it's pre-envelope; the operator's inherent
                    wave shape morphs between square, sine and sawtooth, regardless of the current
                    envelope, gain, or variations.

                    when an operator modulates another, it's post-envelope.
                    */

                    let operatorJ = this.instrumentOperators[j];
                    let modulation = operatorJ.modulationLevels[opNameI];

                    if (j === i) {
                        let prev = this.lastOpOutputsPre[j];

                        if (modulation > 0) {
                            modulatedAngle += prev * MODULATION_WEIGHT * modulation;
                        }

                        if (modulation < 0) {
                            modulatedAngle += prev * prev * MODULATION_WEIGHT * (-modulation);
                        }
                    } else {
                        let prev = this.lastOpOutputsPost[j];

                        modulatedAngle += prev * MODULATION_WEIGHT * modulation;
                    }
                }

                let preSample = Math.sin(modulatedAngle);
                this.opScratchPre[i] = preSample;
                this.opScratchPost[i] = preSample * operatorI.gain * envelopeGains[i];
            } else {
                this.opScratchPre[i] = 0;
                this.opScratchPost[i] = 0;
            }
        }

        /*
        in the scratch space, apply each variation to the operator signals, one after another
        */

        for (let variation of this.instrument.variations) {
            if (variation === null) {
                break;
            }

            let inputFrom = variation.inputFrom;
            let inputTo = variation.inputTo;

            let inputValue = 0;
            switch (variation.input) {
                case "note":
                    inputValue = this.note;
                    break;

                case "velocity":
                    inputValue = this.velocity;
                    break;

                case "lfo":
                    inputValue = lfo;
                    break;

                case "mod":
                    inputValue = this.modWheel;
                    break;
            }

            let ratio = 0;
            if (inputFrom < inputTo) {
                if (inputValue <= inputFrom) {
                    ratio = 0;
                } else if (inputValue >= inputTo) {
                    ratio = 1;
                } else {
                    ratio = (inputValue - inputFrom) / (inputTo - inputFrom);
                }
            } else {
                if (inputValue <= inputTo) {
                    ratio = 0;
                } else if (inputValue >= inputFrom) {
                    ratio = 1;
                } else {
                    ratio = (inputValue - inputFrom) / (inputTo - inputFrom);
                }
            }

            let outputFrom = variation.outputFrom;
            let outputTo = variation.outputTo;
            let outputMul = outputFrom + (outputTo - outputFrom) * ratio;

            switch (variation.output) {
                case "lfo":
                    lfo *= outputMul;
                    break;

                case "a":
                    this.opScratchPost[0] *= outputMul;
                    break;

                case "b":
                    this.opScratchPost[1] *= outputMul;
                    break;

                case "c":
                    this.opScratchPost[2] *= outputMul;
                    break;

                case "d":
                    this.opScratchPost[3] *= outputMul;
                    break;
            }
        }

        /*
        store the outputs
        */

        for (let i = 0; i < 4; i++) {
            this.lastOpOutputsPre[i] = this.opScratchPre[i];
            this.lastOpOutputsPost[i] = this.opScratchPost[i];
        }

        /*
        mix the final result, and return it
        */

        let mixedSample = 0;

        for (let i = 0; i < 4; i++) {
            let opName = OPERATOR_NAMES[i];
            let op = this.instrument[opName];

            mixedSample += this.lastOpOutputsPost[i] * op.outputLevel;
        }

        return mixedSample;
    }

    /*
    the low-frequency oscillator
    */

    lfo = 0;

    lfoAngle = 0;
    lfoAngleInc: number; //per sample

    lfoTimeSeconds: number;

    advanceLfoBy(numSamples: number) {
        this.lfoTimeSeconds += numSamples * (1 / sampleRate);

        this.lfo = 0;
        if (this.lfoTimeSeconds >= this.instrument.lfoDelaySeconds) {
            this.lfoAngle += this.lfoAngleInc * numSamples;

            //the waveforms start from 0 and range from 0 to 1, which adds a little complexity
            switch (this.instrument.lfoWave) {
                case "sine":
                    this.lfo = (Math.sin(this.lfoAngle - Math.PI * 0.5) + 1) * 0.5;
                    break;

                case "triangle":
                    let triPhase = (this.lfoAngle / Math.PI) % 2;
                    this.lfo = 1 - Math.abs(1 - triPhase);
                    break;

                case "square":
                    //to avoid pops/clicks, we generate a smoother square wave by clipping
                    //a very tall triangle wave
                    let sqPhase = (this.lfoAngle / Math.PI) % 2;
                    this.lfo = 1 - Math.abs(1 - sqPhase);
                    this.lfo = Math.max(0, Math.min(1, (this.lfo * 11) - 5));
                    break;

                case "sawtooth":
                    let sawPhase = (this.lfoAngle / Math.PI) % 2;

                    this.lfo = (sawPhase < 0.2) ? (sawPhase * 5) : (1 - (sawPhase - 0.2) / 1.8);
                    break;
            }

            if (this.instrument.lfoAttackSeconds > 0) {
                this.lfo *= Math.min(
                    (this.lfoTimeSeconds - this.instrument.lfoDelaySeconds)
                        / this.instrument.lfoAttackSeconds,
                    1,
                );
            }
        }
    }

    /*
    bringing it all together...

    other than the operators, we calculate everything with k-rate precision: we find the values
    at the start and end of the block, then lerp between them by repeated addition
    */

    //scratch buffers, to avoid allocation
    scratchStartEnvelope = [0, 0, 0, 0];
    scratchEndEnvelope = [0, 0, 0, 0];
    scratchEnvelope = [0, 0, 0, 0];
    scratchEnvelopeInc = [0, 0, 0, 0];

    process (
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ) {
        const mono = outputs[0][0];

        /*
        find start/end values for various parameters
        */

        let startTime = currentTime;
        let endTime = startTime + mono.length / sampleRate;

        let startLfo = this.lfo;
        this.advanceLfoBy(mono.length);
        let endLfo = this.lfo;

        let startFadeGain = this.fadeGain;
        let fadingOut = false;
        if (endTime >= this.fadeInTime) {
            if (this.fadeOutTime !== null && endTime >= this.fadeOutTime) {
                fadingOut = true;

                this.fadeGain = Math.max(0, this.fadeGain - this.fadeRate * mono.length);
            } else {
                this.fadeGain = Math.min(this.fadeGain + this.fadeRate * mono.length, MAX_VOLUME);
            }
        }
        let endFadeGain = this.fadeGain;

        for (let opI = 0; opI < 4; opI++) {
            this.scratchStartEnvelope[opI] = this.envelopes[opI].gain;
            this.envelopes[opI].advanceBy(mono.length);
            this.scratchEndEnvelope[opI] = this.envelopes[opI].gain;
        }

        /*
        set up iterators
        */

        let recipNumSamples = 1 / mono.length;

        let time = startTime;
        let timeInc = (endTime - startTime) * recipNumSamples;

        let lfo = startLfo;
        let lfoInc = (endLfo - startLfo) * recipNumSamples;

        let fadeGain = startFadeGain;
        let fadeGainInc = (endFadeGain - startFadeGain) * recipNumSamples;

        for (let opI = 0; opI < 4; opI++) {
            this.scratchEnvelope[opI] = this.scratchStartEnvelope[opI];
            this.scratchEnvelopeInc[opI] =
                (this.scratchEndEnvelope[opI] - this.scratchStartEnvelope[opI]) * recipNumSamples;
        }

        /*
        generate samples
        */

        for (let i = 0; i < mono.length; i++) {
            let sample = this.advanceOperators(lfo, this.scratchEnvelope);

            mono[i] = sample * fadeGain;

            time += timeInc;
            lfo += lfoInc;
            fadeGain += fadeGainInc;
            this.scratchEnvelope[0] += this.scratchEnvelopeInc[0];
            this.scratchEnvelope[1] += this.scratchEnvelopeInc[1];
            this.scratchEnvelope[2] += this.scratchEnvelopeInc[2];
            this.scratchEnvelope[3] += this.scratchEnvelopeInc[3];
        }

        /*
        check for various end-of-voice conditions
        */

        let ending = false;

        if (fadingOut && endFadeGain <= 0) {
            ending = true;
        }

        let allEnvelopesFinished = true;
        for (let envelope of this.envelopes) {
            if (envelope.state !== "finished" || envelope.dampedLevel !== envelope.level) {
                allEnvelopesFinished = false;
                break;
            }
        }

        if (allEnvelopesFinished) {
            ending = true;
        }

        if (this.samplesSinceLastPing !== null) {
            this.samplesSinceLastPing += mono.length;
            if (this.samplesSinceLastPing >= PING_EXPECTED_SAMPLES * 2) {
                ending = true;
            }
        }

        if (this.audioStarvedPings >= 2) {
            ending = true;
        }

        /*
        either end the voice, or return true so that processing will continue
        */

        if (ending) {
            this.port.postMessage({
                messageType: "ended",
            });

            this.port.close();

            return false;
        }

        return true;
    }
}

registerProcessor("voice-processor", VoiceProcessor);

/*
envelope generators. relatively straightforward, only two major quirks:

    - in order to avoid clicks and pops, the output is damped, limiting it to a constant
      maximum rate of change. (attempted to achieve this by tweaking timings instead, but
      it turned out to be too complex)
    
    - the release rate can vary:
        - for an upward-sloping release (uncommon), we always instantly change the envelope
          level to the envelope's nominal start-of-release level
        - for a downward-sloping release:
            - when the starting level is >= the nominal starting level, we accelerate the rate
              so that the release's duration matches its nominal duration
            - when the starting level is < the nominal level, we use the release's nominal
              fade-out rate, so that the actual release duration is quickened
*/

type EnvelopeState = "delay" | "attack" | "decay" | "sustain" | "release" | "finished";

const MAX_DAMPED_CHANGE_PER_SAMPLE = 1 / (sampleRate * MIN_TRANSITION_TIME);

class Envelope {
    state: EnvelopeState;
    samplesToNextState: number | null;

    level: number;
    levelInc: number;

    dampedLevel: number;

    delaySamples: number;
    attackStartLevel: number;
    attackSamples: number;
    attackLevelInc: number;
    decayStartLevel: number;
    decaySamples: number;
    decayLevelInc: number;
    sustainLevel: number;
    nominalReleaseSamples: number;
    nominalReleaseLevelInc: number;
    releaseEndLevel: number;

    /*
    advanceBy() won't actually be called until noteDownTime onwards, so if noteDownTime is
    in the future, the envelope should be initialised to the start of the "delay" phase
    */

    constructor(
        src: ({ level: number, seconds: number })[],
        enabled: boolean,
        noteDownTime: number,
        noteUpTime: number | null,
        time: number
    ) {
        /*
        deconstruct the source envelope, from the Instrument
        */

        this.delaySamples = Math.round(src[0].seconds * sampleRate);
        this.attackStartLevel = src[0].level;
        this.attackSamples = Math.round((src[1].seconds - src[0].seconds) * sampleRate);
        this.decayStartLevel = src[1].level;
        this.decaySamples = Math.round((src[2].seconds - src[1].seconds) * sampleRate);
        this.sustainLevel = src[2].level;
        this.nominalReleaseSamples = Math.round((src[3].seconds - src[2].seconds) * sampleRate);
        this.releaseEndLevel = src[3].level;

        this.attackLevelInc = (this.decayStartLevel - this.attackStartLevel)
            / Math.max(1, this.attackSamples);
        this.decayLevelInc = (this.sustainLevel - this.decayStartLevel)
            / Math.max(1, this.decaySamples);
        this.nominalReleaseLevelInc = (this.releaseEndLevel - this.sustainLevel)
            / Math.max(1, this.nominalReleaseSamples);

        /*
        seek to the specified time in the envelope.

        we start by pretending that the note has not been released - if this is true, this gives
        us an accurate level; if it's false, it gives us our starting level for a subsequent
        release() call.
        */

        let elapsedSamples = Math.max(0, Math.round((time - noteDownTime) * sampleRate));

        if (elapsedSamples < this.delaySamples) {
            this.state = "delay";
            this.samplesToNextState = this.delaySamples - elapsedSamples;
            this.level = 0;
            this.levelInc = 0;
        } else if (elapsedSamples < this.delaySamples + this.attackSamples) {
            let progress = (elapsedSamples - this.delaySamples) / this.attackSamples;

            this.state = "attack";
            this.samplesToNextState = Math.round((1 - progress) * this.attackSamples);
            this.level = this.attackStartLevel
                + (this.decayStartLevel - this.attackStartLevel) * progress;
            this.levelInc = this.attackLevelInc;
        } else if (
            elapsedSamples < this.delaySamples + this.attackSamples + this.decaySamples
        ) {
            let progress = (elapsedSamples - (this.delaySamples + this.attackSamples))
                / this.decaySamples;

            this.state = "decay";
            this.samplesToNextState = Math.round((1 - progress) * this.decaySamples);
            this.level = this.decayStartLevel
                + (this.sustainLevel - this.decayStartLevel) * progress;
            this.levelInc = this.decayLevelInc;
        } else {
            this.state = "sustain";
            this.samplesToNextState = null;
            this.level = this.sustainLevel;
            this.levelInc = 0;
        }

        if (noteUpTime !== null && time >= noteUpTime) {
            this.release(noteUpTime);

            let elapsedReleaseSamples = Math.max(0, Math.round((time - noteUpTime) * sampleRate));

            let currentLevel = this.level + elapsedReleaseSamples * this.levelInc;

            if (currentLevel > this.releaseEndLevel || this.levelInc > 0) {
                this.state = "release";
                this.samplesToNextState = Math.max(
                    0, 
                    Math.min(
                        Math.round((this.releaseEndLevel - currentLevel) / this.levelInc),
                        this.nominalReleaseSamples,
                    )
                );
                this.level = currentLevel;
            } else {
                this.state = "finished";
                this.samplesToNextState = null;
                this.level = 0;
                this.levelInc = 0;
            }
        }

        this.dampedLevel = (elapsedSamples === 0) ? 0 : this.level;

        /*
        if this operator is disabled, start in the "finished" state
        */

        if (!enabled) {
            this.state = "finished";
            this.samplesToNextState = null;
            this.level = 0;
            this.levelInc = 0;
            this.dampedLevel = 0;
        }
    }

    release(noteUpTime: number) {
        if (this.state !== "release" && this.state !== "finished") {
            if (this.nominalReleaseSamples === 0) {
                this.state = "finished";
                this.samplesToNextState = null;
                this.level = 0;
                this.levelInc = 0;
            } else {
                this.state = "release";

                if (this.nominalReleaseLevelInc > 0) {
                    this.samplesToNextState = this.nominalReleaseSamples;
                    this.level = this.sustainLevel;
                    this.levelInc = this.nominalReleaseLevelInc;
                } else {
                    if (this.level > this.sustainLevel) {
                        this.samplesToNextState = this.nominalReleaseSamples;
                        this.levelInc = (this.releaseEndLevel - this.level)
                            / this.samplesToNextState;
                    } else {
                        let difference = this.releaseEndLevel - this.level;
                        let nominalDifference = this.releaseEndLevel - this.sustainLevel;

                        //hacky workaround for a divide-zero-by-zero error...
                        if (Math.abs(difference) < 0.01 && Math.abs(nominalDifference) < 0.01) {
                            this.samplesToNextState = this.nominalReleaseSamples;
                        } else {
                            this.samplesToNextState = Math.round(
                                this.nominalReleaseSamples
                                    * Math.max(0, Math.min(1, difference / nominalDifference))
                            );
                        }

                        this.levelInc = difference / Math.max(1, this.samplesToNextState);
                    }
                }
            }
        }
    }

    advanceBy(numSamples: number) {
        let samplesRemaining = numSamples;

        while (this.samplesToNextState !== null && this.samplesToNextState < samplesRemaining) {
            samplesRemaining -= this.samplesToNextState;

            switch (this.state) {
                case "delay":
                    this.state = "attack";
                    this.samplesToNextState = this.attackSamples;
                    this.level = this.attackStartLevel;
                    this.levelInc = this.attackLevelInc;
                    break;

                case "attack":
                    this.state = "decay";
                    this.samplesToNextState = this.decaySamples;
                    this.level = this.decayStartLevel;
                    this.levelInc = this.decayLevelInc;
                    break;

                case "decay":
                    this.state = "sustain";
                    this.samplesToNextState = null;
                    this.level = this.sustainLevel;
                    this.levelInc = 0;
                    break;

                case "release":
                    this.state = "finished";
                    this.samplesToNextState = null;
                    this.level = 0;
                    this.levelInc = 0;
                    break;

                case "sustain":
                case "finished":
                    throw new Error("unreachable code");
            }
        }

        this.level += this.levelInc * samplesRemaining;

        if (this.samplesToNextState !== null) {
            this.samplesToNextState -= samplesRemaining;
        }
        samplesRemaining = 0;

        /*
        damping. effectively k-rate, not a-rate
        */

        if (this.dampedLevel < this.level) {
            this.dampedLevel =
                Math.min(this.dampedLevel + MAX_DAMPED_CHANGE_PER_SAMPLE * numSamples, this.level);
        } else if (this.dampedLevel > this.level) {
            this.dampedLevel =
                Math.max(this.dampedLevel - MAX_DAMPED_CHANGE_PER_SAMPLE * numSamples, this.level);
        } else {
            this.dampedLevel = this.level;
        }
    }

    //in order for envelopes to be perceptually linear, they need to be exponential
    get gain() {
        return Math.pow(0.5, (1 - this.dampedLevel) * 10);
    }
}
