import { MidiFile } from "./midiFile";

/*
the data model for musical notes

it wrangles note input from several sources: the on-screen piano (both mouse and keyboard
events), the demo track, and web midi. there's also an "ignore all input" flag, active while
the popup dialog is visible.

from these sources, we generate:
    - "notedown" and "noteup" events
    - an api to query whether a particular note is currently down in any
      source; this is used for visualising the on-screen piano

we also have one set of mod-wheel and pitch-wheel values (not one per input!). the wheel
values can be mutated imperatively, either via mouse input or via an attached midi device.
*/

export class MusicModel {
    constructor() {
        this.initKeyboard();
        this.initMidi();
    }

    /*
    the globalMute property should be set to `true` while the popup dialog is visible. it stops
    playing the demo track (if any), instantaneously releases all notes, and causes any note-down
    events to be ignored.
    */

    private globalMuteValue = false;

    get globalMute() {
        return this.globalMuteValue;
    }

    set globalMute(newValue: boolean) {
        if (this.globalMuteValue !== newValue) {
            if (newValue === true) {
                this.releaseAllNotes();
                this.stopDemoTrack();
            }

            this.globalMuteValue = newValue;
        }
    }

    /*
    "notedown" and "noteup" events are fired for each individual note
    */

    private eventTarget = new EventTarget();

    addEventListener(ty: MusicModelEventType, listener: (ev: any) => any) {
        this.eventTarget.addEventListener(ty, (ev: Event) => listener(ev));
    }

    removeEventListener(ty: MusicModelEventType, listener: (ev: any) => any) {
        this.eventTarget.removeEventListener(ty, (ev: Event) => listener(ev));
    }

    /*
    each virtual piano is represented by an array of "is-down?" booleans, one for each note.
    these booleans are used by noteIsDown(), and used to discard spurious note-up events.
    */

    private vpKeyboard: VirtualPiano = new Array(NUM_NOTES).fill(false);
    private vpMouse: VirtualPiano = new Array(NUM_NOTES).fill(false);
    private vpDemo: VirtualPiano = new Array(NUM_NOTES).fill(false);
    private vpMidi: VirtualPiano = new Array(NUM_NOTES).fill(false);

    noteIsDown(note: number) {
        if (note < LOWEST_NOTE || note >= LOWEST_NOTE + NUM_NOTES) {
            return false;
        }

        for (let vp of [this.vpKeyboard, this.vpMouse, this.vpDemo, this.vpMidi]) {
            if (vp[note - LOWEST_NOTE]) {
                return true;
            }
        }

        return false;
    }

    mouseNoteIsDown(note: number) {
        if (note < LOWEST_NOTE || note >= LOWEST_NOTE + NUM_NOTES) {
            return false;
        }

        return this.vpMouse[note - LOWEST_NOTE];
    }

    pressNote(source: NoteSource, note: number, velocity: number) {
        if (note < LOWEST_NOTE || note >= LOWEST_NOTE + NUM_NOTES) {
            return;
        }

        if (this.globalMuteValue) {
            return;
        }

        let vp = [this.vpKeyboard, this.vpMouse, this.vpDemo, this.vpMidi][source];
        let vpIndex = note - LOWEST_NOTE;
        if (!vp[vpIndex]) {
            vp[vpIndex] = true;

            this.eventTarget.dispatchEvent(new NoteEvent(
                source,
                note,
                velocity,
                true,
            ));
        }
    }

    releaseNote(source: NoteSource, note: number) {
        if (note < LOWEST_NOTE || note >= LOWEST_NOTE + NUM_NOTES) {
            return;
        }

        let vp = [this.vpKeyboard, this.vpMouse, this.vpDemo, this.vpMidi][source];
        let vpIndex = note - LOWEST_NOTE;
        if (vp[vpIndex]) {
            vp[vpIndex] = false;

            this.eventTarget.dispatchEvent(new NoteEvent(
                source,
                note,
                null,
                false,
            ));
        }
    }

    releaseAllNotes() {
        for (let note = LOWEST_NOTE; note < LOWEST_NOTE + NUM_NOTES; note++) {
            this.releaseNote(SOURCE_KEYBOARD, note);
            this.releaseNote(SOURCE_MOUSE, note);
            this.releaseNote(SOURCE_DEMO, note);
            this.releaseNote(SOURCE_MIDI, note);
        }
    }

    /*
    we don't attempt to consolidate different wheel inputs - they're just mutated imperatively,
    the most recent input taken to be the canonical one.

    while a wheel is being manipulated using the mouse, any midi events which would affect
    that wheel are discarded instead, to prevent thrashing
    */

    private modWheelValue = 0.0; //0 to 1
    private pitchWheelValue = 0.0; //-1 to 1

    get modWheel() { return this.modWheelValue; }
    get pitchWheel() { return this.pitchWheelValue; }

    set modWheel(newValue: number) {
        let clampedValue = Math.max(0.0, Math.min(1.0, newValue));

        this.modWheelValue = clampedValue;
        this.eventTarget.dispatchEvent(new Event("modwheel"));
    }

    set pitchWheel(newValue: number) {
        let clampedValue = Math.max(-1.0, Math.min(1.0, newValue));

        this.pitchWheelValue = clampedValue;
        this.eventTarget.dispatchEvent(new Event("pitchwheel"));
    }

    private wheelLocks = {
        mod: false,
        pitch: false,
    };

    lockWheel(wheel: "mod" | "pitch") {
        this.wheelLocks[wheel] = true;
    }

    unlockWheel(wheel: "mod" | "pitch") {
        this.wheelLocks[wheel] = false;
    }

    /*
    any keyboard input which has been allowed to propagate to the window is assumed to be fair
    game for the on-screen piano. call ev.stopPropagation() to prevent this
    */

    initKeyboard() {
        window.addEventListener("keydown", (ev) => this.onKeyDown(ev));
        window.addEventListener("keyup", (ev) => this.onKeyUp(ev));
        window.addEventListener("blur", () => this.onWindowBlur());
    }

    private static SHORTCUTS: Record<string, number> = {
        "Z": 60,
            "S": 61,
        "X": 62,
            "D": 63,
        "C": 64,
        "V": 65,
            "G": 66,
        "B": 67,
            "H": 68,
        "N": 69,
            "J": 70,
        "M": 71,

        "Q": 72,
            "2": 73,
        "W": 74,
            "3": 75,
        "E": 76,
        "R": 77,
            "5": 78,
        "T": 79,
            "6": 80,
        "Y": 81,
            "7": 82,
        "U": 83,

        "I": 84,
            "9": 85,
        "O": 86,
            "0": 87,
        "P": 88,
    };

    private static KEYBOARD_VELOCITY = 75;

    onKeyDown(ev: KeyboardEvent) {
        if (ev.repeat) {
            return;
        }

        let note: number | undefined = MusicModel.SHORTCUTS[ev.key.toUpperCase()];
        if (note !== undefined) {
            let offsetNote = note + this.octaveOffset;

            this.pressNote(SOURCE_KEYBOARD, offsetNote, MusicModel.KEYBOARD_VELOCITY);
        }
    }

    onKeyUp(ev: KeyboardEvent) {
        let note: number | undefined = MusicModel.SHORTCUTS[ev.key.toUpperCase()];
        if (note !== undefined) {
            let offsetNote = note + this.octaveOffset;

            this.releaseNote(SOURCE_KEYBOARD, offsetNote);
        }
    }

    onWindowBlur() {
        /*
        tricky firefox/chome bug (todo?): the window "blur" and "focusout" events do not fire
        when a context menu is opened with right-click, or when the main menu is focused by
        pressing alt, even though those actions do redirect key focus away from the browser.
        listening to document or document.body is no help. addEventListener's `useCapture`
        parameter doesn't help.
        */

        this.releaseAllKeyAndMouseNotes();
    }

    /*
    mouse input to the on-screen piano. the raw mouse events are processed by Piano; MusicModel
    is only notified when particular mouse-controlled notes have been pressed or released.
    */

    pressMouseNote(note: number, velocity: number) {
        this.pressNote(SOURCE_MOUSE, note, velocity);
    }

    releaseMouseNote(note: number) {
        this.releaseNote(SOURCE_MOUSE, note);
    }

    releaseAllMouseNotes() {
        for (let note = LOWEST_NOTE; note < LOWEST_NOTE + NUM_NOTES; note++) {
            this.releaseNote(SOURCE_MOUSE, note);
        }
    }

    releaseAllKeyAndMouseNotes() {
        for (let note = LOWEST_NOTE; note < LOWEST_NOTE + NUM_NOTES; note++) {
            this.releaseNote(SOURCE_KEYBOARD, note);
            this.releaseNote(SOURCE_MOUSE, note);
        }
    }

    /*
    the octaveOffset should be added to all incoming mouse/keyboard inputs. (it has no effect
    within the MusicModel itself, except its handling of keyboard inputs.)

    this would potentially cause a mismatch between note-down and note-up events. our simple
    workaround is to release all mouse/keyboard notes when the octaveOffset changes.
    */

    private octaveOffsetValue: OctaveOffset = 0;

    get octaveOffset() {
        return this.octaveOffsetValue;
    }

    set octaveOffset(newValue: OctaveOffset) {
        if (newValue !== this.octaveOffsetValue) {
            this.releaseAllKeyAndMouseNotes();
            this.octaveOffsetValue = newValue;

            this.eventTarget.dispatchEvent(new Event("octaveoffsetchange"));
        }
    }

    /*
    while we have an active demoTrack, we need to trigger notes. setInterval has relatively low
    scheduling priority, and requestAnimationFrame stops running if the window is unfocused; as
    a compromise, we simply use both.

    todo?: we still see timing glitches. the more-rigorous alternative would be high-precision
    advance scheduling of notes in the Mixer. however, it would add a lot of complexity to Mixer's
    api and implementation, and it might increase latency.
    */

    private demoTrack: MidiFile | null = null;
    private demoTrackIntervalID: number | null = null;
    private demoTrackRafID: number | null = null;

    playingDemoTrack() {
        return this.demoTrack !== null;
    }

    playDemoTrack(demoTrack: MidiFile) {
        if (this.demoTrack !== null) {
            this.stopDemoTrack();
        }

        let callback: (isFromRaf: boolean) => void;
        let lastTimestamp: DOMHighResTimeStamp | null = null;
        let elapsedTime = 0;
        let nextMessageI = 0;
        callback = (isFromRaf: boolean) => {
            let timestamp = performance.now();
            let deltaTime = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
            lastTimestamp = timestamp;
            elapsedTime += deltaTime / 1000;

            let messages = this.demoTrack!.messages;
            while (
                nextMessageI < messages.length &&
                messages[nextMessageI].atSeconds < elapsedTime
            ) {
                let message = messages[nextMessageI];
                switch (message.type) {
                    case "notedown":
                        this.pressNote(SOURCE_DEMO, message.note, message.velocity);
                        break;

                    case "noteup":
                        this.releaseNote(SOURCE_DEMO, message.note);
                        break;

                    case "end":
                        this.releaseAllDemoNotes();
                        break;
                }

                nextMessageI += 1;
            }

            //demo tracks loop endlessly
            if (nextMessageI === messages.length) {
                nextMessageI = 0;
                elapsedTime = 0;
            }

            if (isFromRaf) {
                this.demoTrackRafID = window.requestAnimationFrame(() => callback(true));
            }
        };

        this.demoTrack = demoTrack;
        this.demoTrackIntervalID = window.setInterval(() => callback(false), 10);
        this.demoTrackRafID = window.requestAnimationFrame(() => callback(true));
    }

    stopDemoTrack() {
        if (this.demoTrack !== null) {
            window.clearInterval(this.demoTrackIntervalID!);
            window.cancelAnimationFrame(this.demoTrackRafID!);

            this.demoTrack = null;
            this.demoTrackIntervalID = null;
            this.demoTrackRafID = null;

            this.releaseAllDemoNotes();

            this.eventTarget.dispatchEvent(new Event("demostop"));
        }
    }

    releaseAllDemoNotes() {
        for (let note = LOWEST_NOTE; note < LOWEST_NOTE + NUM_NOTES; note++) {
            this.releaseNote(SOURCE_DEMO, note);
        }
    }

    /*
    just like keyboard input, midi device input is processed directly by the MusicModel

    todo?: if we were being really perfectionist, we could maintain a separate virtual keyboard
    for each  separate midi input device, rather than unifying all of the "noteon" and "noteoff"
    messages to a single virtual keyboard
    */

    initMidi() {
        let navigator = window.navigator as any;

        if (navigator.requestMIDIAccess !== undefined) {
            navigator.requestMIDIAccess({ sysex: false })
                .then((access: any) => {
                    /*
                    after acquiring midi access, attempt to open every input device (a no-op if
                    it's already open), and route its "midimessage` event to this.onMidiMessage
                    (a no-op if it's already routed). repeat the whole process on "statechange".
                    */

                    let processInputs = (inputs: any) => {
                        for (let [_, input] of inputs) {
                            input
                                .open()
                                .then(() => {
                                    input.onmidimessage = (ev: any) => this.onMidiMessage(ev);
                                });
                        }
                    };
                    
                    processInputs(access.inputs);

                    access.addEventListener("statechange", (ev: any) => {
                        if (ev.port.type === "input") {
                            processInputs(access.inputs);
                        }
                    });
                })
                .catch((err: Error) => {
                    console.log(`unable to acquire midi access (${err.name}: ${err.message})`);
                });
        }
    }

    onMidiMessage(ev: any) {
        if (ev.data.length < 1) {
            return;
        }

        let status = ev.data[0] & 0xf0;

        //note-on message
        if (status === 0x80 && ev.data.length >= 2) {
            this.releaseNote(SOURCE_MIDI, ev.data[1]);
        }

        //note-off message
        if (status === 0x90 && ev.data.length >= 3) {
            this.pressNote(SOURCE_MIDI, ev.data[1], ev.data[2]);
        }

        if (!this.wheelLocks.mod) {
            //controller-change message
            if (status === 0xB0 && ev.data.length >= 3) {
                let controller = ev.data[1];
                let rawValue = ev.data[2];

                //modulation wheel controller
                if (controller === 1 && rawValue <= 127) {
                    let value = rawValue / 127;

                    this.modWheel = value;
                }
            }
        }

        if (!this.wheelLocks.pitch) {
            //pitch-bend message
            if (status === 0xE0 && ev.data.length >= 3) {
                let lsb = ev.data[1];
                let msb = ev.data[2];

                if (lsb <= 127 && msb <= 127) {
                    let rawValue = ((msb << 7) + lsb) - 8192;
                    let value = (rawValue >= 0) ? (rawValue / 8191) : (rawValue / 8192);

                    this.pitchWheel = value;
                }
            }
        }
    }
}

type VirtualPiano = boolean[];

export const LOWEST_NOTE = 21; //midi note value for A0
export const NUM_NOTES = 93; //required to support the on-screen keyboard at 15va

type MusicModelEventType =
    "notedown" |
    "noteup" |
    "octaveoffsetchange" |
    "demostop" |
    "modwheel" |
    "pitchwheel";

export class NoteEvent extends Event {
    source: NoteSource;
    note: number;
    velocity: number | null;
    down: boolean;

    constructor(source: NoteSource, note: number, velocity: number | null, down: boolean) {
        super(down ? "notedown" : "noteup");

        this.source = source;
        this.note = note;
        this.velocity = velocity;
        this.down = down;
    }
}

const SOURCE_KEYBOARD = 0;
const SOURCE_MOUSE = 1;
const SOURCE_DEMO = 2;
const SOURCE_MIDI = 3;

export type NoteSource = typeof SOURCE_KEYBOARD
    | typeof SOURCE_MOUSE
    | typeof SOURCE_DEMO
    | typeof SOURCE_MIDI;

export type OctaveOffset = -24 | -12 | 0 | 12 | 24;
