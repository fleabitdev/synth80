import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useEffect, useRef, useState] = [React.useEffect, React.useRef, React.useState];

import { notifyReleasedPointerCapture } from "./app";
import { MusicModel, NoteEvent, OctaveOffset } from "./musicModel";

/*
the on-screen piano, and associated buttons/wheels

the piano processes mouse events itself, but keyboard and midi-input events are handled
globally, by the MusicModel. each key's up/down state is visualised based on the MusicModel,
rather than using local mouse events or the :active selector
*/

export interface PianoProps {
    noteOffset: number,
    musicModel: MusicModel,
}

export function Piano(props: PianoProps) {
    /*
    the piano keys
    */

    const SHORTCUTS: [string | null, string | null][] = [
        [null, null],
        ["Z", "S"],
        ["X", "D"],
        ["C", null],
        ["V", "G"],
        ["B", "H"],
        ["N", "J"],
        ["M", null],
        ["Q", "2"],
        ["W", "3"],
        ["E", null],
        ["R", "5"],
        ["T", "6"],
        ["Y", "7"],
        ["U", null],
        ["I", "9"],
        ["O", "0"],
        ["P", null],
        [null, null],
    ];

    const BLACK_KEYS: [boolean, number | null][] = [
        [true, 60],
        [true, 70],
        [false, null],
        [true, 60],
        [true, 65],
        [true, 70],
        [false, null],
    ];

    let leftmostNote = 59 + props.noteOffset;

    let pianoKeyPairs = [...Array(19)].map(function (_, keyPairI) {
        let [hasBlack, blackLeftPercent] = BLACK_KEYS[(keyPairI + 6) % 7];

        if (keyPairI === 18) {
            hasBlack = false;
        }

        let whiteNote = leftmostNote
            + Math.floor(keyPairI / 7) * 12
            + [0, 1, 3, 5, 6, 8, 10][keyPairI % 7];
        let blackNote = hasBlack ? whiteNote + 1 : null;

        let [whiteShortcut, blackShortcut] = SHORTCUTS[keyPairI];

        return (
            <PianoKeyPair
                key={"pair" + whiteNote}
                
                whiteNote={whiteNote}
                whiteShortcut={whiteShortcut}

                hasBlack={hasBlack}
                blackLeftPercent={blackLeftPercent}
                blackNote={blackNote}
                blackShortcut={blackShortcut}

                musicModel={props.musicModel} />
        );
    });

    /*
    the octave buttons. rather than duplicating state which is available in the MusicModel, we
    use a dummy state variable to force a re-render when the octave offset changes.
    */

    let [octaveDummy, setOctaveDummy] = useState(1000);

    function onOctaveClick(newOctaveOffset: OctaveOffset) {
        if (newOctaveOffset !== props.musicModel.octaveOffset) {
            props.musicModel.octaveOffset = newOctaveOffset;
        } else {
            props.musicModel.octaveOffset = 0;
        }

        setOctaveDummy(octaveDummy + 1);
    }

    function octaveClassName(octaveOffset: OctaveOffset) {
        return (octaveOffset === props.musicModel.octaveOffset ? "led lit" : "led");
    }

    /*
    bringing it all together...
    */

    return (
        <div className="piano-panel plastic-panel">
            <PianoWheel label="PITCH" wheel="pitch" musicModel={props.musicModel} />
            <PianoWheel label="MOD" wheel="mod" musicModel={props.musicModel} />
            <div className="piano-keyboard">
                {pianoKeyPairs}
            </div>
            <div className="piano-octaves">
                <div
                    className="button no-bottom-edge"
                    onClick={() => onOctaveClick(24)}>
                    <div className={octaveClassName(24)} />
                    <div>15va</div>
                </div>
                <div
                    className="button no-top-edge no-bottom-edge"
                    onClick={() => onOctaveClick(12)}>
                    <div className={octaveClassName(12)} />
                    <div>8va</div>
                </div>
                <div
                    className="button no-top-edge no-bottom-edge"
                    onClick={() => onOctaveClick(-12)}>
                    <div className={octaveClassName(-12)} />
                    <div>8vb</div>
                </div>
                <div
                    className="button no-top-edge"
                    onClick={() => onOctaveClick(-24)}>
                    <div className={octaveClassName(-24)} />
                    <div>15vb</div>
                </div>
            </div>
        </div>
    );
}

interface PianoKeyPairProps {
    whiteNote: number,
    whiteShortcut: string | null,

    hasBlack: boolean,
    blackLeftPercent: number | null,
    blackNote: number | null,
    blackShortcut: string | null,

    musicModel: MusicModel,
}

function PianoKeyPair(props: PianoKeyPairProps) {
    /*
    each individual piano key listens to the MusicModel for changes in its note, so that
    we're not re-rendering the entire keyboard whenever a piano key is pressed.
    */

    let [whiteDown, setWhiteDown] = useState(false);
    let [blackDown, setBlackDown] = useState(false);

    useEffect(() => {
        let listener = () => {
            let modelWhiteDown =
                props.musicModel.noteIsDown(props.whiteNote + props.musicModel.octaveOffset);

            if (whiteDown !== modelWhiteDown) {
                setWhiteDown(modelWhiteDown);
            }

            if (props.blackNote !== null) {
                let modelBlackDown =
                    props.musicModel.noteIsDown(props.blackNote + props.musicModel.octaveOffset);
                
                if (blackDown !== modelBlackDown) {
                    setBlackDown(modelBlackDown);
                }
            }
        };

        props.musicModel.addEventListener("notedown", listener);
        props.musicModel.addEventListener("noteup", listener);
        props.musicModel.addEventListener("octaveoffsetchange", listener);

        return () => {
            props.musicModel.removeEventListener("notedown", listener);
            props.musicModel.removeEventListener("noteup", listener);
            props.musicModel.removeEventListener("octaveoffsetchange", listener);
        };
    });

    /*
    mouse input handling
    
    note that we don't allow the note to be re-triggered while the note is visibly down, even if
    it's only down because of keyboard or midi input. the alternative would feel wrong!
    */

    function velocityForMouseY(ev: React.MouseEvent) {
        //find the target note's html element
        let target = ev.target as HTMLElement;
        while (
            target.className !== "piano-white-key" &&
            target.className !== "piano-black-key-border"
        ) {
            target = target.parentElement!;
        }

        //find the y-coordinate relative to that element's bounding rect
        let mouseY = ev.clientY;
        let { top, bottom } = target.getBoundingClientRect();

        let ratio = Math.max(0.0, Math.min(1.0, (mouseY - top) / (bottom - top)));

        //lerp the velocity based on that y-coord
        const MIN_VELOCITY = 32;
        const MAX_VELOCITY = 112;

        return Math.round(MIN_VELOCITY + (MAX_VELOCITY - MIN_VELOCITY) * ratio);
    }

    function onMouseDown(ev: React.MouseEvent, note: number) {
        if (ev.button === 0) {
            let offsetNote = note + props.musicModel.octaveOffset;

            if (!props.musicModel.noteIsDown(offsetNote)) {
                props.musicModel.pressMouseNote(offsetNote, velocityForMouseY(ev));
            }
        }
    }

    function onMouseUp(ev: React.MouseEvent, note: number) {
        if (ev.button === 0) {
            let offsetNote = note + props.musicModel.octaveOffset;

            if (props.musicModel.mouseNoteIsDown(offsetNote)) {
                props.musicModel.releaseMouseNote(offsetNote);
            }
        }
    }

    function onMouseEnter(ev: React.MouseEvent, note: number) {
        if ((ev.buttons & 1) === 1) {
            let offsetNote = note + props.musicModel.octaveOffset;

            if (!props.musicModel.noteIsDown(offsetNote)) {
                props.musicModel.pressMouseNote(offsetNote, velocityForMouseY(ev));
            }
        }
    }

    function onMouseLeave(ev: React.MouseEvent, note: number) {
        /*
        bug (todo?): while lagging (for example, during heavy printing to the console), firefox
        does not consistently fire "mouseleave" events when the cursor moves rapidly over the
        piano with the lmb held down
        */

        if ((ev.buttons & 1) === 1) {
            let offsetNote = note + props.musicModel.octaveOffset;

            if (props.musicModel.mouseNoteIsDown(offsetNote)) {
                props.musicModel.releaseMouseNote(offsetNote);
            }
        }
    }

    /*
    rendering...
    */

    let whiteShortcut: React.ReactElement | null = null;
    if (props.whiteShortcut !== null) {
        whiteShortcut = <div className="piano-shortcut">{props.whiteShortcut}</div>;
    }

    let blackShortcut: React.ReactElement | null = null;
    if (props.blackShortcut !== null) {
        blackShortcut = <div className="piano-shortcut">{props.blackShortcut}</div>;
    }

    let whiteClassName = "piano-white-key" + (whiteDown ? " down" : "");
    let blackClassName = "piano-black-key" + (blackDown ? " down" : "");

    let blackKey = null;
    if (props.hasBlack) {
        blackKey = (
            <div
                className="piano-black-key-border"
                style={{left: (props.blackLeftPercent! + 2.5) + "%"}}
                key={"black" + props.blackNote!}
                onMouseDown={(ev) => onMouseDown(ev, props.blackNote!)}
                onMouseUp={(ev) => onMouseUp(ev, props.blackNote!)}
                onMouseEnter={(ev) => onMouseEnter(ev, props.blackNote!)}
                onMouseLeave={(ev) => onMouseLeave(ev, props.blackNote!)}>
                <div className={blackClassName}>
                    {blackShortcut}
                </div>
            </div>
        );
    }

    let whiteKey = (
        <div
            className={whiteClassName}
            key={"white" + props.whiteNote!}
            onMouseDown={(ev) => onMouseDown(ev, props.whiteNote)}
            onMouseUp={(ev) => onMouseUp(ev, props.whiteNote)}
            onMouseEnter={(ev) => onMouseEnter(ev, props.whiteNote)}
            onMouseLeave={(ev) => onMouseLeave(ev, props.whiteNote)}>
            {whiteShortcut}
            {blackKey}
        </div>
    );

    return (
        <div className="piano-key-pair">
            {whiteKey}
            {blackKey}
        </div>
    );
}

interface PianoWheelProps {
    label: string,
    wheel: "pitch" | "mod",
    musicModel: MusicModel,
}

function PianoWheel(props: PianoWheelProps) {
    let [wheelValue, setWheelValue] = useState(0.0);

    useEffect(() => {
        let onWheelChange = () => {
            setWheelValue(
                props.wheel === "pitch" ? props.musicModel.pitchWheel : props.musicModel.modWheel
            );
        };

        let eventName: "pitchwheel" | "modwheel" =
            (props.wheel === "pitch") ? "pitchwheel" : "modwheel";

        props.musicModel.addEventListener(eventName, onWheelChange);
        return () => props.musicModel.removeEventListener(eventName, onWheelChange);
    });

    let updateWheel = (ev: React.PointerEvent) => {
        let { top, bottom } = ev.currentTarget.getBoundingClientRect();

        let padding = 10;
        top += padding;
        bottom -= padding;

        let mouseY = ev.clientY;
        let ratio = Math.max(0.0, Math.min(1.0, (mouseY - top) / (bottom - top)));

        switch (props.wheel) {
            case "mod":
                props.musicModel.modWheel = 1.0 - ratio;
                break;

            case "pitch":
                props.musicModel.pitchWheel = (0.5 - ratio) * 2.0;
                break;
        }
    };

    let onPointerDown = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            props.musicModel.lockWheel(props.wheel);

            updateWheel(ev);
        }
    };

    let onPointerMove = (ev: React.PointerEvent) => {
        if ((ev.buttons & 1) === 1 && ev.currentTarget.hasPointerCapture(ev.pointerId)) {
            updateWheel(ev);
        }
    };

    let onPointerUp = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.releasePointerCapture(ev.pointerId);
            notifyReleasedPointerCapture();

            props.musicModel.unlockWheel(props.wheel);

            if (props.wheel === "pitch") {
                props.musicModel.pitchWheel = 0.0;
            }
        }
    };

    let onLostPointerCapture = () => {
        props.musicModel.unlockWheel(props.wheel);

        notifyReleasedPointerCapture();
    };

    /*
    rendering...
    */

    let renderedValue = (props.wheel === "pitch") ? 0.5 + wheelValue * 0.5 : wheelValue;
    let renderedYScale = 1.0 - (Math.abs(renderedValue - 0.5) * 0.2);

    return (
        <div className="wheel-and-label">
            <div className="wheel-label">{props.label}</div>
            <div
                className="wheel"
                onPointerDown={(ev) => onPointerDown(ev)}
                onPointerMove={(ev) => onPointerMove(ev)}
                onPointerUp={(ev) => onPointerUp(ev)}
                onLostPointerCapture={() => onLostPointerCapture()}
                style={{
                    "--value": renderedValue,
                    "--notch-y-scale": renderedYScale,
                }}>
                <div className="wheel-notch" />
            </div>
        </div>
    );
}
