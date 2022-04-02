import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext } from "./app";

/*
the list of instruments, in the left column
*/

export function InstrumentList(props: {}) {
    let instrumentModel = useContext(InstrumentContext);
    
    let [names, setNames] = useState(instrumentModel.instrumentNames);
    let [selectedI, setSelectedI] = useState(instrumentModel.activeInstrument);

    let onInstrumentClick = (i: number) => {
        if (i !== selectedI) {
            setSelectedI(i);
            instrumentModel.activeInstrument = i;
        }
    };

    let onInstrumentDelete = (i: number) => {
        if (i >= 0 && i < instrumentModel.numInstruments) {
            instrumentModel.deleteInstrument(i);

            setNames(instrumentModel.instrumentNames);
            setSelectedI(instrumentModel.activeInstrument);
        }
    };

    let onInstrumentCopy = () => {
        instrumentModel.copyInstrument(selectedI);

        setNames(instrumentModel.instrumentNames);
        setSelectedI(instrumentModel.activeInstrument);
    };

    let onNameChange = (i: number, newName: string) => {
        let newNames = [...names];
        newNames[i] = newName;

        setNames(newNames);
        instrumentModel.merge({ name: newName });
    };

    /*
    rendering...
    */

    let instruments = names.map((name, i) => {
        return (
            <Instrument
                key={i}
                i={i}
                name={name}
                selected={selectedI === i}
                allowDeletion={names.length > 1}
                onClick={onInstrumentClick}
                onNameChange={(newName: string) => onNameChange(i, newName)}
                onDeleteClick={onInstrumentDelete} />
        );
    });

    return (
        <div className="instrument-list lcd-panel">
            {instruments}
            <div
                className="instrument copy-instrument"
                onClick={onInstrumentCopy}>
                <div className="instrument-name">
                    Copy Instrument...
                </div>
            </div>
        </div>
    );
}

interface InstrumentProps {
    i: number,
    name: string,
    selected: boolean,
    allowDeletion: boolean,
    onClick: (i: number) => void,
    onNameChange: (newName: string) => void,
    onDeleteClick: (i: number) => void,
}

export function Instrument(props: InstrumentProps) {
    let [editing, setEditing] = useState(false);
    let inputRef = useRef<HTMLInputElement>(null);

    let onRenameClick = (ev: React.MouseEvent) => {
        setEditing(true);

        /*
        the name is an <input> which is normally disabled (with various css properties set on
        it to hide its nature). when the rename icon is clicked, we enable the <input> until
        it's unfocused, and immediately select all of its text. (browser behaviour with regard
        to focus is a bit temperamental; change this at your own peril)
        */

        inputRef.current!.disabled = false;
        inputRef.current!.removeAttribute("disabled");
        inputRef.current!.focus();
        inputRef.current!.select();

        props.onClick(props.i);
        ev.stopPropagation();
    };

    let onNameBlur = (ev: React.FocusEvent) => {
        setEditing(false);

        let selection = document.getSelection();
        if (selection !== null) {
            selection.removeAllRanges();
        }
    };

    let onNameKeyDown = (ev: React.KeyboardEvent) => {
        if (ev.key === "Enter") {
            (ev.currentTarget as HTMLElement).blur();
        }

        ev.stopPropagation();
    };

    let onNameChange = (ev: React.SyntheticEvent) => {
        let newName = inputRef.current!.value.toUpperCase();

        props.onNameChange(newName);
    };

    return (
        <div
            className={"instrument" + (props.selected ? " selected" : "")}
            onClick={() => props.onClick(props.i)}
            onDoubleClick={onRenameClick}>
            <input
                type="text"
                ref={inputRef}
                className="instrument-name"
                value={props.name}
                minLength={0}
                maxLength={14}
                size={14}
                disabled={!editing}
                onBlur={onNameBlur}
                onKeyDown={onNameKeyDown}
                onChange={onNameChange} />
            <img
                src="./icons.svg#svgView(viewBox(2560,0,512,512))"
                onClick={onRenameClick} />
            {
                props.allowDeletion ? (
                    <img
                        src="./icons.svg#svgView(viewBox(3072,0,512,512))"
                        onClick={(ev: React.MouseEvent) => {
                            props.onDeleteClick(props.i);
                            ev.stopPropagation();
                        }} />
                ) : null
            }
        </div>
    );
}
