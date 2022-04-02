import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext, notifyReleasedPointerCapture } from "./app";
import {
    mergeVariations, PartialVariation, VariationInput, VariationOutput
} from "./instrumentModel";
import { NUM_NOTES, LOWEST_NOTE } from "./musicModel";

/*
the variation racks, in the middle column
*/

export interface VariationProps {
    rackSlot: number,
    onDelete: () => void,
}

export function Variation(props: VariationProps) {
    let instrumentModel = useContext(InstrumentContext);
    let variation = instrumentModel.instrument.variations[props.rackSlot]!;

    let merge = (partial: PartialVariation) => {
        let newVariations = instrumentModel.instrument.variations
        let [mergedVariation, variationMutated] = mergeVariations(
            newVariations[props.rackSlot]!,
            partial,
        );

        if (variationMutated) {
            newVariations[props.rackSlot] = mergedVariation;
            instrumentModel.merge({ variations: newVariations });
        }
    };

    /*
    the local state and callbacks

    we take care to preserve separate values for each input type, so that values aren't lost
    if the user briefly traverses through, say, note -> velocity -> note
    */
    
    let [input, setInput] = useState(variation.input);

    let [noteInputFrom, setNoteInputFrom] = useState(
        variation.input === "note" ? variation.inputFrom : LOWEST_NOTE
    );
    let [noteInputTo, setNoteInputTo] = useState(
        variation.input === "note" ? variation.inputTo : (LOWEST_NOTE + NUM_NOTES - 1)
    );

    let [velocityInputFrom, setVelocityInputFrom] = useState(
        variation.input === "velocity" ? variation.inputFrom : 0
    );
    let [velocityInputTo, setVelocityInputTo] = useState(
        variation.input === "velocity" ? variation.inputTo : 127
    );

    let [lfoInputFrom, setLfoInputFrom] = useState(
        variation.input === "lfo" ? variation.inputFrom : 0
    );
    let [lfoInputTo, setLfoInputTo] = useState(
        variation.input === "lfo" ? variation.inputTo : 1
    );

    let [modInputFrom, setModInputFrom] = useState(
        variation.input === "mod" ? variation.inputFrom : 0
    );
    let [modInputTo, setModInputTo] = useState(
        variation.input === "mod" ? variation.inputTo : 1
    );

    let [output, setOutput] = useState(variation.output);
    let [outputFrom, setOutputFrom] = useState(variation.outputFrom);
    let [outputTo, setOutputTo] = useState(variation.outputTo);

    let inputFromTo = (forInput: VariationInput): [number, number] => {
        switch (forInput) {
            case "note":
                return [noteInputFrom, noteInputTo];

            case "velocity":
                return [velocityInputFrom, velocityInputTo];

            case "lfo":
                return [lfoInputFrom, lfoInputTo];

            case "mod":
                return [modInputFrom, modInputTo];
        }
    };

    let onInputClick = (newInput: VariationInput) => {
        if (newInput !== input) {
            let [newInputFrom, newInputTo] = inputFromTo(newInput);

            setInput(newInput);
            merge({
                input: newInput,
                inputFrom: newInputFrom,
                inputTo: newInputTo,
            });
        }
    };

    let onInputFromChange = (newInputFrom: number) => {
        if (newInputFrom !== inputFrom) {
            switch (input) {
                case "note":
                    setNoteInputFrom(newInputFrom);
                    break;

                case "velocity":
                    setVelocityInputFrom(newInputFrom);
                    break;

                case "lfo":
                    setLfoInputFrom(newInputFrom);
                    break;

                case "mod":
                    setModInputFrom(newInputFrom);
                    break;
            }

            merge({ inputFrom: newInputFrom });
        }
    };

    let onInputToChange = (newInputTo: number) => {
        if (newInputTo !== inputTo) {
            switch (input) {
                case "note":
                    setNoteInputTo(newInputTo);
                    break;

                case "velocity":
                    setVelocityInputTo(newInputTo);
                    break;

                case "lfo":
                    setLfoInputTo(newInputTo);
                    break;

                case "mod":
                    setModInputTo(newInputTo);
                    break;
            }

            merge({ inputTo: newInputTo });
        }
    };

    let onOutputClick = (newOutput: VariationOutput) => {
        if (newOutput !== output) {
            setOutput(newOutput);
            merge({ output: newOutput });
        }
    };

    let onOutputFromChange = (newOutputFrom: number) => {
        if (newOutputFrom !== outputFrom) {
            setOutputFrom(newOutputFrom);
            merge({ outputFrom: newOutputFrom });
        }
    };

    let onOutputToChange = (newOutputTo: number) => {
        if (newOutputTo !== outputTo) {
            setOutputTo(newOutputTo);
            merge({ outputTo: newOutputTo });
        }
    };

    /*
    synchronisation with the InstrumentModel, when the active instrument changes
    */

    useEffect(() => {
        let isMounted = true;
        let callback = () => {
            if (!isMounted) {
                return;
            }

            let variation = instrumentModel.instrument.variations[props.rackSlot]!;

            if (variation === null) {
                //this Variation is about to be removed from the Rack, so its
                //contents are unimportant
                return;
            }

            setInput(variation.input);

            setNoteInputFrom(variation.input === "note" ? variation.inputFrom : LOWEST_NOTE);
            setNoteInputTo(
                variation.input === "note" ? variation.inputTo : (LOWEST_NOTE + NUM_NOTES - 1)
            );

            setVelocityInputFrom(variation.input === "velocity" ? variation.inputFrom : 0);
            setVelocityInputTo(variation.input === "velocity" ? variation.inputTo : 127);

            setLfoInputFrom(variation.input === "lfo" ? variation.inputFrom : 0);
            setLfoInputTo(variation.input === "lfo" ? variation.inputTo : 1);

            setModInputFrom(variation.input === "mod" ? variation.inputFrom : 0);
            setModInputTo(variation.input === "mod" ? variation.inputTo : 1);

            setOutput(variation.output);
            setOutputFrom(variation.outputFrom);
            setOutputTo(variation.outputTo);
        };

        instrumentModel.addEventListener("activeinstrumentchange", callback);
        return () => {
            isMounted = false;
            instrumentModel.removeEventListener("activeinstrumentchange", callback);
        };
    });

    /*
    rendering...
    */

    let [inputFrom, inputTo] = inputFromTo(input);
    let inputMode = ((input === "lfo" || input === "mod") ? "ratio" : input) as FieldMode;

    let inputChoiceClass = (thisInput: VariationInput) => {
        return "choice" + (input === thisInput ? " selected" : "");
    };

    let outputChoiceClass = (thisOutput: VariationOutput) => {
        return "choice"
            + (output === thisOutput ? " selected" : "")
            + (thisOutput.length === 1 ? " single-letter" : "");
    };

    let InputChoice = (props: { input: VariationInput, text: string }) => {
        return (
            <div
                className={inputChoiceClass(props.input)}
                onClick={() => onInputClick(props.input)}>
                {props.text}
            </div>
        );
    };

    let OutputChoice = (props: { output: VariationOutput, text: string }) => {
        return (
            <div
                className={outputChoiceClass(props.output)}
                onClick={() => onOutputClick(props.output)}>
                {props.text}
            </div>
        );
    };

    return (
        <div className="rack-slot" style={{gridArea: "rk" + props.rackSlot}}>
            <div className="rack-variation plastic-panel">
                <div className="label input-label">INPUT</div>
                <div className="lcd-panel small choices input-choices">
                    <InputChoice input="note" text="NOTE" />
                    <InputChoice input="velocity" text="VEL" />
                    <InputChoice input="lfo" text="LFO" />
                    <InputChoice input="mod" text="MOD" />
                </div>
                <div className="label input-from-label">FROM</div>
                <Field
                    mode={inputMode}
                    extraClass="input-from-field"
                    value={inputFrom}
                    onChange={onInputFromChange} />
                <div className="label input-to-label">TO</div>
                <Field
                    mode={inputMode}
                    extraClass="input-to-field"
                    value={inputTo}
                    onChange={onInputToChange} />

                <div className="label output-label">OUTPUT</div>
                <div className="lcd-panel small choices output-choices">
                    <OutputChoice output="lfo" text="LFO" />
                    <OutputChoice output="a" text="A" />
                    <OutputChoice output="b" text="B" />
                    <OutputChoice output="c" text="C" />
                    <OutputChoice output="d" text="D" />
                </div>
                <div className="label output-from-label">FROM</div>
                <Field
                    mode="ratio"
                    extraClass="output-from-field"
                    value={outputFrom}
                    onChange={onOutputFromChange} />
                <div className="label output-to-label">TO</div>
                <Field
                    mode="ratio"
                    extraClass="output-to-field"
                    value={outputTo}
                    onChange={onOutputToChange} />

                <div className="rack-delete-container">
                    <div className="button" onClick={props.onDelete}>
                        <img src="./icons.svg#svgView(viewBox(2048,0,512,512))" />
                    </div>
                </div>
            </div>
        </div>
    );
}

type FieldMode =
    "note" |     //midi note values, displayed as e.g. C4 or E#5
    "velocity" | //midi velocity values from 0 to 127, displayed as integers
    "ratio";     //a value from 0 to 1 inclusive, displayed with two decimal places

interface FieldProps {
    mode: FieldMode,
    extraClass: string,
    value: number,
    onChange: (newValue: number) => void,
}

function Field(props: FieldProps) {
    /*
    the dragging callbacks
    */

    let [cursor, setCursor] = useState<"auto" | "ns-resize">("auto");
    let dragStart = useRef<{ startY: number, startValue: number } | null>(null);

    let dragSpeed: number;
    let minValue: number;
    let maxValue: number;
    let toRound: boolean;
    switch (props.mode) {
        case "note":
            dragSpeed = 64;
            minValue = LOWEST_NOTE;
            maxValue = (LOWEST_NOTE + NUM_NOTES) - 1;
            toRound = true;
            break;

        case "velocity":
            dragSpeed = 64;
            minValue = 0;
            maxValue = 127;
            toRound = true;
            break;

        case "ratio":
            dragSpeed = 1;
            minValue = 0;
            maxValue = 1;
            toRound = false;
            break;
    }

    let onPointerDown = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            dragStart.current = {
                startY: ev.clientY,
                startValue: props.value,
            };
            setCursor("ns-resize");
        }
    };

    let onPointerMove = (ev: React.PointerEvent) => {
        if (
            (ev.buttons & 1) === 1 &&
            ev.currentTarget.hasPointerCapture(ev.pointerId) &&
            dragStart.current !== null
        ) {
            let { startY, startValue } = dragStart.current;

            let yDiff = startY - ev.clientY;
            let newValue = Math.max(
                minValue,
                Math.min(
                    maxValue,
                    startValue + yDiff * (dragSpeed / 120)
                )
            );

            if (toRound) {
                newValue = Math.round(newValue);
            }

            props.onChange(newValue);
        }
    };

    let onLostPointerCapture = (ev: React.PointerEvent) => {
        notifyReleasedPointerCapture();

        dragStart.current = null;
        setCursor("auto");
    };

    let onPointerUp = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.releasePointerCapture(ev.pointerId);
            onLostPointerCapture(ev);
        }
    };

    /*
    rendering...
    */

    let text;
    switch (props.mode) {
        case "note":
            let octave = Math.floor((props.value - 21) / 12);
            let noteWithinOctave = (props.value - 21) % 12;

            const NOTE_NAMES = [
                "A ", "A#", "B ", "C ", "C#", "D ", "D#", "E ", "F ", "F#", "G ", "G#"
            ];

            text = NOTE_NAMES[noteWithinOctave] + "\xa0" + octave;
            break;

        case "velocity":
            text = props.value.toFixed(0);
            break;

        case "ratio":
            text = props.value.toFixed(2);
            break;
    }

    return (
        <div
            className={"lcd-panel small field " + props.extraClass}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onLostPointerCapture={onLostPointerCapture}
            onPointerUp={onPointerUp}>
            <div className="field-value">
                {text}
            </div>
        </div>
    );
}
