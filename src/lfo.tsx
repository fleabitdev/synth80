import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext } from "./app";
import { LfoWave } from "./instrumentModel";
import { Parameter } from "./operator";

/*
the lfo controls in the right column
*/

export function Lfo(props: {}) {
    let instrumentModel = useContext(InstrumentContext);
    let instrument = instrumentModel.instrument;

    /*
    the wave-picker control
    */

    let [wave, setWave] = useState(instrument.lfoWave);

    let onWaveClick = (ev: React.MouseEvent, newWave: LfoWave) => {
        if (ev.button === 0) {
            instrumentModel.merge({ lfoWave: newWave });
            setWave(newWave);
        }
    };

    let waveElements = [];
    let waveNames: LfoWave[] = ["sine", "triangle", "square", "sawtooth"];
    for (let [i, waveName] of waveNames.entries()) {
        let className = (wave === waveName) ? "selected" : "";
        let srcX = 2048 + (i * 512);
        let srcY = 534 + ((wave === waveName) ? 512 : 0);

        waveElements.push(
            <img
                className={className}
                key={waveName}
                src={`./icons.svg#svgView(viewBox(${srcX},${srcY},512,448))`}
                onClick={(ev) => onWaveClick(ev, waveName)} />
        );
    }

    /*
    the delay, attack and frequency parameters. in all cases, the meter is quadratic,
    to provide better resolution at smaller time-values
    */

    const MAX_DELAY = 2.0;
    const MAX_ATTACK = 2.0;
    const MIN_FREQUENCY = 0.1;
    const MAX_FREQUENCY = 8.0;
    const EXPONENT = 2;

    let [delay, setDelay] = useState(instrument.lfoDelaySeconds);
    let [attack, setAttack] = useState(instrument.lfoAttackSeconds);
    let [frequency, setFrequency] = useState(instrument.lfoFrequencyHz);

    let delayFill = Math.pow(delay / MAX_DELAY, 1 / EXPONENT); 
    let attackFill = Math.pow(attack / MAX_ATTACK, 1 / EXPONENT); 
    let frequencyFill = Math.pow(
        (frequency - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY),
        1 / EXPONENT
    );

    let onDelayFillChange = (fill: number) => {
        let newDelay = Math.pow(fill, EXPONENT) * MAX_DELAY;

        instrumentModel.merge({ lfoDelaySeconds: newDelay });
        setDelay(newDelay);
    };

    let onAttackFillChange = (fill: number) => {
        let newAttack = Math.pow(fill, EXPONENT) * MAX_ATTACK;

        instrumentModel.merge({ lfoAttackSeconds: newAttack });
        setAttack(newAttack);
    };

    let onFrequencyFillChange = (fill: number) => {
        let newFrequency =
            MIN_FREQUENCY + Math.pow(fill, EXPONENT) * (MAX_FREQUENCY - MIN_FREQUENCY);

        instrumentModel.merge({ lfoFrequencyHz: newFrequency });
        setFrequency(newFrequency);
    };

    /*
    synchronisation with the InstrumentModel, when the active instrument changes
    */

    useEffect(() => {
        let callback = () => {
            let instrument = instrumentModel.instrument;

            setWave(instrument.lfoWave);
            setDelay(instrument.lfoDelaySeconds);
            setAttack(instrument.lfoAttackSeconds);
            setFrequency(instrument.lfoFrequencyHz);
        };

        instrumentModel.addEventListener("activeinstrumentchange", callback);
        return () => instrumentModel.removeEventListener("activeinstrumentchange", callback);
    });

    /*
    rendering...
    */

    return (
        <div className="lfo-cell">
            <div className="label">WAVE</div>
            <div className="wave-picker-container">
                <div className="wave-picker lcd-panel small">
                    {waveElements}
                </div>
            </div>
            <Parameter
                label="DELAY"
                units="S"
                value={delay}
                decimalPlaces={2}
                fill={delayFill}
                defaultFill={0}
                onFillChange={onDelayFillChange} />
            <Parameter
                label="ATTACK"
                units="S"
                value={attack}
                decimalPlaces={2}
                fill={attackFill}
                defaultFill={0}
                onFillChange={onAttackFillChange} />
            <Parameter
                label="FREQ"
                units="Hz"
                value={frequency}
                decimalPlaces={2}
                fill={frequencyFill}
                defaultFill={
                    Math.pow((1 - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY), 1 / 2)
                }
                onFillChange={onFrequencyFillChange} />
        </div>
    );
}
