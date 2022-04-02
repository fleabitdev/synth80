import { Instrument, InstrumentModel } from "./instrumentModel";
import { MusicModel, NoteSource } from "./musicModel";

/*
the Mixer manages a collection of voices (notes which are currently being played). each voice is
represented by an AudioWorkletNode, and its output is streamed directly out to the global
AudioContext. the basic commands are "play this note", "stop sustaining all voices which belong to
this note", and "force-stop all voices" (used to silence output when the popup dialog is opened).

once a voice has been triggered, it's a big simplification if all of its parameters (e.g. ADSR
envelope, fm matrix, pitch-shift) can be kept immutable. however, we also want the ability to
change voices while they're in-flight, so that the user can (e.g.) hold down a piano key while
simultaneously fine-tuning an operator's feedback value. in-flight modification is also strictly
necessary to implement the pitch-wheel and mod-wheel.

we could handle this explicitly (for example, by defining each instrument parameter and variation
source as an a-rate `input` to every AudioWorkletNode). however, this would add huge amounts of
complexity, it could impact performance, and avoiding discontinuities (clicks and pops) would be
a challenge. instead, we implement a global solution which will work reasonably well, without
modification, for all possible instrument changes:

    - we allow a voice to be created with a specified amount of "already-elapsed time"

    - we listen for instrument-change events from the Model and wheel-change events from the
      MusicModel, then in response...
        - buffer those events so that they're handled no more than once every 60ms
        - at those 60ms intervals, trigger a 30ms-long crossfade after a 20ms delay. this fades
          out all ongoing voices, and fades in new voices using up-to-date parameters

the main downside of this approach is that it reduces the reciprocal throughput and average
latency of the pitch-wheel and mod-wheel to 60ms and 70ms, respectively, which is slow enough to
be noticeable. if it becomes an issue, we could consider special-casing those two wheels as k-rate
inputs to the AudioWorkletNode.

one other downside is that it effectively doubles the polyphony during a crossfade. this can cause
audio glitching in the best cause, or can cause a chain reaction which locks up the audio thread
in the worst case.
*/

export const SAMPLE_RATE = 48_000;
const MAX_POLYPHONY = 8;

export class Mixer {
    private instrumentModel: InstrumentModel;
    private musicModel: MusicModel;

    private ctx: AudioContext;
    private compressor: DynamicsCompressorNode;

    private nextVoiceKey = 0;
    private voices: Record<string, Voice> = {};

    constructor(instrumentModel: InstrumentModel, musicModel: MusicModel) {
        this.instrumentModel = instrumentModel;
        this.musicModel = musicModel;

        /*
        using a fixed sample rate isn't the best for audio quality, but it's simpler than
        the alternative. from the spec: "an implementation MUST support sample rates in
        at least the range 8000 to 96000"

        ideally we'd use the "interactive" latencyHint, but our renderer just isn't fast
        enough for that. the "playback" hint gives us a lot more performance headroom before
        we start seeing glitches. chrome reports that it only increases the buffer size from
        10ms to 20ms, which should still be acceptable for interactive use.
        */

        this.ctx = new AudioContext({
            latencyHint: "playback",
            sampleRate: SAMPLE_RATE
        });

        /*
        routing the output through a compressor helps us to maintain a good loudness level
        without risking clipping (especially for instruments like simple sine waves)
        */

        this.compressor = new DynamicsCompressorNode(
            this.ctx,
            { /* the default settings seem fine */ },
        );

        this.compressor.connect(this.ctx.destination);

        /*
        we ignore MusicModel events until after the audio worklet class has been registered
        */

        this.ctx.audioWorklet.addModule("./audioWorklet.js")
            .then(() => {
                musicModel.addEventListener("notedown", (ev) => {
                    this.onNoteDown(ev.source, ev.note, ev.velocity!);
                });

                musicModel.addEventListener("noteup", (ev) => {
                    this.onNoteUp(ev.source, ev.note);
                });
            });

        /*
        in order to prevent annoying autoplay behaviour, AudioContexts tend to start suspended,
        and they can only be resumed in response to user interaction.

        we brute-force the problem by attaching a listener to any "mousedown" or "keydown"
        event captured by the window. (we can't be more conservative than this, because web midi
        input events don't count as user interaction. we need to eagerly respond to any input
        which might occur before the first web midi input.)
        */

        let onUserInteraction = () => {
            if (this.ctx.state === "suspended") {
                /*
                resume() returns a Promise. however, there's no need to block on the Promise,
                because "context time" will not progress until it's actually unsuspended. in order
                to avoid queueing up lots of simultaneous notes, we effectively limit MAX_POLYPHONY
                to 1 while the context is suspended (in other words, we only admit the single note
                which actually caused the context to resume).
                */

                this.ctx.resume();
            }
        };

        window.addEventListener("keydown", onUserInteraction, true);
        window.addEventListener("mousedown", onUserInteraction, true);

        /*
        once every 60ms, check for whether the instrument, pitch-wheel or mod-wheel have
        changed, and if so recreate every voice with the new parameters.
        */

        instrumentModel.addEventListener("activeinstrumentchange", () => this.toRecreate = true);
        instrumentModel.addEventListener("mutateinstrument", () => this.toRecreate = true);
        musicModel.addEventListener("pitchwheel", () => this.toRecreate = true);
        musicModel.addEventListener("modwheel", () => this.toRecreate = true);

        window.setInterval(
            () => {
                if (this.toRecreate) {
                    this.toRecreate = false;
                    this.recreateAllVoices();
                }
            },
            60,
        );

        /*
        twice per second, send a "ping" message to all extant voices. see audioWorklet.ts
        for the rationale
        */

        window.setInterval(
            () => {
                for (let voiceKey in this.voices) {
                    this.voices[voiceKey].ping();
                }
            },
            1000 * PING_INTERVAL_SECONDS,
        );
    }

    /*
    the globalMute property should be set to `true` while the popup dialog is visible. it
    force-stops all voices and prevents new ones from being created
    */

    private globalMuteValue = false;

    get globalMute() {
        return this.globalMuteValue;
    }

    set globalMute(newValue: boolean) {
        if (this.globalMuteValue !== newValue) {
            if (newValue === true) {
                this.forceStopAllVoices();
            }

            this.globalMuteValue = newValue;
        }
    }

    onNoteDown(source: NoteSource, note: number, velocity: number) {
        if (this.globalMuteValue) {
            return;
        }

        /*
        assign a unique key to the new Voice, construct it, and store it in this.voices
        */

        let voiceKey = this.nextVoiceKey.toString();
        this.nextVoiceKey += 1;

        let voice = new Voice(
            this.ctx,
            this.compressor,
            source,
            note,
            velocity,
            this.musicModel.pitchWheel,
            this.musicModel.modWheel,
            this.instrumentModel.instrument,
            null, //noteDownTime
            null, //noteUpTime
            null, //fadeInTime
        );
        this.voices[voiceKey] = voice;
        voice.onEnd = () => delete this.voices[voiceKey];

        /*
        if this took us above MAX_POLYPHONY, find the oldest extant voice, force-stop it,
        and remove it from this.voices
        */

        let maxPolyphony = this.ctx.state === "suspended" ? 1 : MAX_POLYPHONY;

        let allVoiceKeys = Object.keys(this.voices);
        while (allVoiceKeys.length > maxPolyphony) {
            //find the oldest voice
            let oldestVoiceKey = allVoiceKeys[0];
            let oldestVoiceNoteDownTime = this.voices[oldestVoiceKey].noteDownTime;

            for (let i=1; i<allVoiceKeys.length; i++) {
                let voiceKey = allVoiceKeys[i];
                let voiceNoteDownTime = this.voices[voiceKey].noteDownTime;

                if (voiceNoteDownTime < oldestVoiceNoteDownTime) {
                    oldestVoiceKey = voiceKey;
                    oldestVoiceNoteDownTime = voiceNoteDownTime;
                }
            }

            //force-stop it and delete it
            let oldestVoice = this.voices[oldestVoiceKey];
            oldestVoice.onEnd = null;
            oldestVoice.forceStop();

            delete this.voices[oldestVoiceKey];

            //check whether this deletion has taken us below MAX_POLYPHONY...
            allVoiceKeys = Object.keys(this.voices);
        }
    }

    onNoteUp(source: NoteSource, note: number) {
        for (let voiceKey in this.voices) {
            let voice = this.voices[voiceKey];

            if (voice.source === source && voice.note === note) {
                voice.release();
            }
        }
    }

    forceStopAllVoices() {
        for (let voiceKey in this.voices) {
            let voice = this.voices[voiceKey];

            voice.onEnd = null;
            voice.forceStop();
        }

        this.voices = {};
    }

    private toRecreate = false;

    recreateAllVoices() {
        let newVoices: Record<string, Voice> = {};

        let crossfadeStartTime = this.ctx.currentTime + 0.02;

        for (let oldVoiceKey in this.voices) {
            //stop the old voice...
            let oldVoice = this.voices[oldVoiceKey];
            oldVoice.onEnd = null;
            oldVoice.forceStop(crossfadeStartTime);

            //...and replace it with a new one, with similar parameters
            if (oldVoice.state !== "ended") {
                let newVoiceKey = this.nextVoiceKey.toString();
                this.nextVoiceKey += 1;

                let newVoice = new Voice(
                    this.ctx,
                    this.compressor,
                    oldVoice.source,
                    oldVoice.note,
                    oldVoice.velocity,
                    this.musicModel.pitchWheel,
                    this.musicModel.modWheel,
                    this.instrumentModel.instrument,
                    oldVoice.noteDownTime,
                    oldVoice.noteUpTime,
                    crossfadeStartTime,
                );

                newVoices[newVoiceKey] = newVoice;
                newVoice.onEnd = () => delete this.voices[newVoiceKey];
            }
        }

        this.voices = newVoices;
    }
}

const A4_NOTE = 69;
const A4_PITCH = 440;
const TWELFTH_ROOT_OF_2 = Math.pow(2.0, 1.0 / 12.0);

type VoiceState = "sustaining" | "released" | "ended";

class Voice {
    private ctx: BaseAudioContext;
    private node: AudioWorkletNode;

    public source: NoteSource;
    public note: number;
    public velocity: number;

    public noteDownTime: number;
    public noteUpTime: number | null;
    private fadeInTime: number;

    private endCallback: (() => void) | null = null;

    public state: VoiceState = "sustaining";
    private sentForceStop = false;

    constructor(
        ctx: BaseAudioContext,
        destination: AudioNode,
        source: NoteSource,
        note: number,
        velocity: number,
        pitchWheel: number,
        modWheel: number,
        instrument: Instrument,
        noteDownTime: number | null,
        noteUpTime: number | null,
        fadeInTime: number | null,
    ) {
        this.ctx = ctx;

        this.source = source;
        this.note = note;
        this.velocity = velocity;

        this.noteDownTime = noteDownTime || this.ctx.currentTime;
        this.noteUpTime = noteUpTime;
        this.fadeInTime = fadeInTime || this.ctx.currentTime;

        //our pitch-bend range is +/- 2 semitones
        let frequency = A4_PITCH * Math.pow(TWELFTH_ROOT_OF_2, (note - A4_NOTE) + pitchWheel * 2);

        let nodeConstructorArgs: AwConstructorArgs = {
            frequency,
            instrument,

            note,
            velocity,
            modWheel,

            noteDownTime,
            noteUpTime,
            fadeInTime,
        };

        this.node = new AudioWorkletNode(
            ctx,
            "voice-processor",
            {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: nodeConstructorArgs
            }
        );

        this.node.port.addEventListener("message", ({ data }) => {
            if (data.messageType === "ended") {
                if (this.state !== "ended") {
                    this.state = "ended";

                    this.node.port.close();
                    this.node.disconnect();

                    if (this.endCallback !== null) {
                        this.endCallback();
                    }
                }
            }
        });

        this.node.port.start();
        this.node.connect(destination);
    }

    set onEnd(endCallback: (() => void) | null) {
        this.endCallback = endCallback;
    }

    release() {
        if (this.state === "sustaining") {
            this.state = "released";
            this.noteUpTime = this.ctx.currentTime;

            this.node.port.postMessage({
                messageType: "release",
                noteUpTime: this.noteUpTime,
            });
        }
    }

    ping() {
        if (this.state !== "ended") {
            this.node.port.postMessage({ messageType: "ping" });
        }
    }

    forceStop(forceStopTime?: number) {
        if (!this.sentForceStop) {
            this.sentForceStop = true;

            //after the voice actually stops, our "ended" message handler will change this.state
            this.node.port.postMessage({
                messageType: "forceStop",
                forceStopTime: forceStopTime || this.ctx.currentTime,
            });
        }
    }
}

export interface AwConstructorArgs {
    frequency: number,
    instrument: Instrument,

    note: number,
    velocity: number,
    modWheel: number,

    noteDownTime: number | null, //null implies currentTime
    noteUpTime: number | null, //null implies not-yet-released
    fadeInTime: number | null, //null implies currentTime
}

//caution: if you change these, also change the definition in audioWorklet.ts
export const MODULATION_WEIGHT = 2.8;
export const PING_INTERVAL_SECONDS = 0.5;
