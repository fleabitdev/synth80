import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext } from "./app";
import { OperatorName } from "./instrumentModel";
import { MODULATION_WEIGHT } from "./mixer";

/*
the waveform visualiser, in the right column.

we can't reuse the audio-worklet code for our waveform-rendering code, because most of the
instrument parameters need to be ignored (e.g. envelopes, variations). the waveform is only
based on operator gain, operator frequency, and the fm matrix. the result is normalised (within
reason) so that the displayed peak value is always 1.0.
*/

const SVG_WIDTH = 188;
const SVG_HEIGHT = 50;
const SVG_STROKE_WIDTH = 1.4;

export function Waveform(props: {}) {
    let instrumentModel = useContext(InstrumentContext);

    /*
    constructing a waveform from the current instrument parameters

    performance: even with all operators, outputs and fm matrix cells enabled, this only takes
    a few milliseconds. no optimisation is required
    */

    let buildGraph = () => {
        let instrument = instrumentModel.instrument;

        let graph = new Array(1 + (SVG_WIDTH - 1) * 2).fill(0);
        let elementsPerPeriod = (SVG_WIDTH - 1) / 2;

        let baseFreq = 440;

        let calcPeriod = (opName: OperatorName): number => {
            let freq = (baseFreq * instrument[opName].frequencyRatio)
                + instrument[opName].frequencyOffsetHz;
            let adjustedFreq = freq / baseFreq;
            let period = elementsPerPeriod / adjustedFreq;

            return period;
        };

        let aPeriod = calcPeriod("a");
        let bPeriod = calcPeriod("b");
        let cPeriod = calcPeriod("c");
        let dPeriod = calcPeriod("d");

        let [aPrev, bPrev, cPrev, dPrev] = [0, 0, 0, 0];

        let calcOperator = (i: number, opName: OperatorName, period: number): number => {
            let naturalAngle = i * Math.PI * 2 / period;

            let modulatedAngle = naturalAngle;

            for (
                let [srcName, srcPrev] of
                [
                    ["a", aPrev],
                    ["b", bPrev],
                    ["c", cPrev],
                    ["d", dPrev],
                ] as [OperatorName, number][]
            ) {
                let modulation = instrument[srcName].modulationLevels[opName];
                let weight = MODULATION_WEIGHT;

                if (srcName === opName) {
                    modulatedAngle += srcPrev * weight * Math.max(0, modulation);
                    modulatedAngle += srcPrev * srcPrev * weight * Math.max(0, -modulation);
                } else {
                    if (instrument[srcName].enabled) {
                        modulatedAngle += srcPrev * weight * instrument[srcName].gain * modulation;
                    }
                }
            }

            return Math.sin(modulatedAngle);
        };

        let peakLevel = 0;

        for (let i = 0; i < graph.length; i++) {
            let a = calcOperator(i, "a", aPeriod);
            let b = calcOperator(i, "b", bPeriod);
            let c = calcOperator(i, "c", cPeriod);
            let d = calcOperator(i, "d", dPeriod);

            let sum = 0;
            for(
                let [opName, signal] of
                [["a", a], ["b", b], ["c", c], ["d", d]] as [OperatorName, number][]
            ) {
                if (instrument[opName].enabled) {
                    sum += signal * instrument[opName].gain * instrument[opName].outputLevel;
                }
            }

            graph[i] = sum;

            peakLevel = Math.max(Math.abs(sum), peakLevel);

            aPrev = a;
            bPrev = b;
            cPrev = c;
            dPrev = d;
        }

        //normalising the output...
        let normalisationRatio = Math.max(0.2, Math.min(5.0, 1 / peakLevel));
        for (let i = 0; i < graph.length; i++) {
            graph[i] *= normalisationRatio;
        }

        return graph.slice(SVG_WIDTH - 1);
    };

    let [graph, setGraph] = useState(buildGraph());

    useEffect(() => {
        let callback = () => {
            setGraph(buildGraph());
        };

        instrumentModel.addEventListener("mutateinstrument", callback);
        instrumentModel.addEventListener("activeinstrumentchange", callback);

        return () => {
            instrumentModel.removeEventListener("mutateinstrument", callback);
            instrumentModel.removeEventListener("activeinstrumentchange", callback);
        };
    }, [instrumentModel]);

    /*
    rendering...
    */

    let lines = [];

    for (let y of [SVG_STROKE_WIDTH / 2, SVG_HEIGHT / 2, SVG_HEIGHT - (SVG_STROKE_WIDTH / 2)]) {
        lines.push(
            <line
                key={"horz" + y}
                x1="0"
                y1={y}
                x2={SVG_WIDTH}
                y2={y}
                fill="none"
                strokeWidth={SVG_STROKE_WIDTH}
                stroke="rgba(34, 34, 34, 0.2)" />
        );
    }

    for (let x of [SVG_STROKE_WIDTH / 2, SVG_WIDTH / 2, SVG_WIDTH - (SVG_STROKE_WIDTH / 2)]) {
        lines.push(
            <line
                key={"vert" + x}
                x1={x}
                y1={SVG_STROKE_WIDTH}
                x2={x}
                y2={SVG_HEIGHT - SVG_STROKE_WIDTH}
                fill="none"
                strokeWidth={SVG_STROKE_WIDTH}
                stroke="rgba(34, 34, 34, 0.2)" />
        );
    }

    let points: string[] = [];

    for (let x = 0; x < SVG_WIDTH; x++) {
        let dstX = (SVG_STROKE_WIDTH / 2) + (x / SVG_WIDTH) * (SVG_WIDTH - SVG_STROKE_WIDTH / 2);
        let dstY = (SVG_HEIGHT / 2) - (graph[x] * (SVG_HEIGHT / 2 - SVG_STROKE_WIDTH * 2));

        points.push(dstX + "," + dstY);
    }

    return (
        <div className="lcd-panel waveform">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width={SVG_WIDTH}
                height={SVG_HEIGHT}>

                {lines}

                <polyline
                    points={points.join(" ")}
                    fill="none"
                    strokeWidth={SVG_STROKE_WIDTH + "px"}
                    stroke="#222"
                    strokeLinecap="round" />
            </svg>
        </div>
    );
}
