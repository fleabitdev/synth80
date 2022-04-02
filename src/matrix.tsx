import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext, notifyReleasedPointerCapture } from "./app";
import { OperatorName } from "./instrumentModel";

/*
the fm matrix, in the right column
*/

export function Matrix(props: {}) {
    let instrumentModel = useContext(InstrumentContext);

    let instrument = instrumentModel.instrument;
    let operatorNames: OperatorName[] = ["a", "b", "c", "d"];

    /*
    we need to render arrows between our "matrix-number" elements. css layout isn't powerful
    enough to support this without a lot of hassle (e.g. dividing each grid cell into 3-by-3,
    then overlapping elements into the same cell).

    instead, we hack around it. useEffect will be called after the initial mount, so we can access
    all of our elements imperatively using refs. we exploit this to imperatively "draw" our arrows
    just after the first render by mutating an svg in the dom, then "redraw" them following a
    window-resize event (which is the only event which could change the size and layout of the
    matrix, disregarding obscure stuff like changes to the browser's font-override settings).

    finally, we imperatively redraw the arrows when a re-render has caused the visibility state
    of one of the "matrix number" elements to change. (we can't do this on every re-render,
    because it would be too slow; we don't have a virtual dom to save us!)
    */

    let matrixRef = useRef<HTMLDivElement>(null);
    let arrowsRef = useRef<SVGSVGElement>(null);

    interface DstRefs {
        a: React.RefObject<HTMLDivElement> | null,
        b: React.RefObject<HTMLDivElement> | null,
        c: React.RefObject<HTMLDivElement> | null,
        d: React.RefObject<HTMLDivElement> | null,
        letter: React.RefObject<HTMLDivElement> | null,
        output: React.RefObject<HTMLDivElement> | null,
    }

    function emptyDstRefs(): DstRefs {
        return {
            a: null,
            b: null,
            c: null,
            d: null,
            letter: null,
            output: null,
        };
    }

    let srcRefs = {
        a: emptyDstRefs(),
        b: emptyDstRefs(),
        c: emptyDstRefs(),
        d: emptyDstRefs(),
    };

    let drawArrows = () => {
        let matrix = matrixRef.current!;
        let svg = arrowsRef.current!;

        //getBoundingClientRect includes borders, which isn't what we want here
        let computedStyle = getComputedStyle(matrix);

        let {
            top: matrixTop,
            bottom: matrixBottom,
            left: matrixLeft,
            right: matrixRight,
        } = matrix.getBoundingClientRect();

        matrixTop += parseFloat(computedStyle.borderTopWidth);
        matrixBottom -= parseFloat(computedStyle.borderBottomWidth);
        matrixLeft += parseFloat(computedStyle.borderLeftWidth);
        matrixRight -= parseFloat(computedStyle.borderRightWidth);

        let matrixWidth = matrixRight - matrixLeft;
        let matrixHeight = matrixBottom - matrixTop;

        const ARROWHEAD_WIDTH = 8;
        const ARROWHEAD_HEIGHT = 7;

        //caution: without markerUnits, the arrowhead will scale with the line's stroke-width
        let text = `
            <defs>
                <marker
                    id="arrowhead"
                    viewBox="0 0 ${ARROWHEAD_WIDTH} ${ARROWHEAD_HEIGHT}"
                    markerUnits="userSpaceOnUse"
                    refX="${ARROWHEAD_WIDTH / 2}"
                    refY="${ARROWHEAD_HEIGHT / 2}"
                    markerWidth="${ARROWHEAD_WIDTH}"
                    markerHeight="${ARROWHEAD_HEIGHT}" 
                    orient="auto">
                    
                    <polygon
                        points="
                            0 0,
                            ${ARROWHEAD_WIDTH} ${ARROWHEAD_HEIGHT / 2},
                            0 ${ARROWHEAD_HEIGHT}
                        "
                        fill="#222" />
                </marker>
            </defs>
        `;

        function drawLine(x1: number, y1: number, x2: number, y2: number) {
            text += `
                <line
                    x1="${x1}"
                    y1="${y1}"
                    x2="${x2}"
                    y2="${y2}"
                    stroke="#222"
                    stroke-width="1.4" />
            `;
        }

        function drawArrow(x1: number, y1: number, x2: number, y2: number) {
            /*
            the end of the line is truncated so that the tip of the arrowhead lands exactly
            on (x2, y2). if the line would be shorter than the arrowhead, the arrowhead is
            centered on the midpoint of the line instead.
            */

            let length = Math.hypot(x2 - x1, y2 - y1);
            let angle = Math.atan2(y2 - y1, x2 - x1);

            let newLength: number;
            if (length <= ARROWHEAD_WIDTH) {
                newLength = length / 2;
            } else {
                newLength = length - ARROWHEAD_WIDTH / 2;
            }

            let newX2 = x1 + Math.cos(angle) * newLength;
            let newY2 = y1 + Math.sin(angle) * newLength;

            text += `
                <line
                    x1="${x1}"
                    y1="${y1}"
                    x2="${newX2}"
                    y2="${newY2}"
                    stroke="#222"
                    stroke-width="1.4"
                    marker-end="url(#arrowhead)" />
            `;
        }

        //returns [x, y, w, h] relative to the matrix
        function getBounds(elt: HTMLElement): [number, number, number, number] {
            let { top, bottom, left, right } = elt.getBoundingClientRect();

            return [
                left - matrixLeft,
                top - matrixTop,
                right - left,
                bottom - top,
            ];
        }

        for (let [srcI, srcName] of (["a", "b", "c", "d"] as OperatorName[]).entries()) {
            let letter = srcRefs[srcName].letter!.current!;
            let output = srcRefs[srcName].output!.current!;
            let feedback = srcRefs[srcName][srcName]!.current!;

            let [letterX, letterY, letterWidth, letterHeight] = getBounds(letter);

            //the two arrows leading to/from the feedback number
            if (!feedback.className.includes("empty")) {
                let [x, y, width, height] = getBounds(feedback);
                let leftArrowX = x + width * 0.25;
                let rightArrowX = x + width * 0.75;

                drawArrow(leftArrowX, y + height, leftArrowX, letterY);
                drawArrow(rightArrowX, letterY, rightArrowX, y + height);
            }

            //arrows or lines leading directly up from the letter
            let iterY = letterY;
            for (let dstI = srcI; dstI > -1; dstI--) {
                let dstName = operatorNames[dstI];
                let number = srcRefs[srcName][dstName]!.current!;

                if (!number.className.includes("empty")) {
                    let [x, y, width, height] = getBounds(number);
                    let arrowX = x + width / 2;

                    //an exception: we only want to connect a letter to its feedback number
                    //if there's another non-empty number above it
                    let toDraw = true;
                    if (dstI === srcI) {
                        toDraw = false;
                        for (let testI = dstI - 1; testI > -1; testI--) {
                            let testName = operatorNames[testI];
                            let testNumber = srcRefs[srcName][testName]!.current!;

                            if (!testNumber.className.includes("empty")) {
                                toDraw = true;
                            }
                        }
                    }

                    if (toDraw) {
                        drawLine(arrowX, iterY, arrowX, y + height);
                    }

                    iterY = y;
                }
            }

            //and likewise leading down
            iterY = letterY + letterHeight;
            for (let dstI = srcI + 1; dstI < 5; dstI++) {
                let dstName = operatorNames[dstI] || "output";
                let number = srcRefs[srcName][dstName]!.current!;

                if (!number.className.includes("empty")) {
                    let [x, y, width, height] = getBounds(number);
                    let arrowX = x + width / 2;

                    drawLine(arrowX, iterY, arrowX, y);
                    iterY = y + height;
                }
            }

            //arrows leading from the left of the letter, towards the letter
            let iterX: number | null = null;
            for (let colI = 0; colI <= srcI; colI++) {
                let colName = operatorNames[colI];
                let numberOrLetter = colI === srcI ?
                    srcRefs[srcName].letter!.current! :
                    srcRefs[colName][srcName]!.current!;

                if(!numberOrLetter.className.includes("empty")) {
                    let [x, y, width, height] = getBounds(numberOrLetter);

                    if (iterX !== null) {
                        let arrowY = y + height / 2;

                        let draw = (colI === srcI) ? drawArrow : drawLine;
                        draw(iterX, arrowY, x, arrowY);
                    }

                    iterX = x + width;
                }
            }

            //likewise, arrows leading from right to left
            iterX = null;
            for (let colI = 3; colI >= srcI; colI--) {
                let colName = operatorNames[colI];
                let numberOrLetter = colI === srcI ?
                    srcRefs[srcName].letter!.current! :
                    srcRefs[colName][srcName]!.current!;

                if(!numberOrLetter.className.includes("empty")) {
                    let [x, y, width, height] = getBounds(numberOrLetter);

                    if (iterX !== null) {
                        let arrowY = y + height / 2;

                        let draw = (colI === srcI) ? drawArrow : drawLine;
                        draw(iterX, arrowY, x + width, arrowY);
                    }

                    iterX = x;
                }
            }

            //the arrow leading from the output number to the bottom edge of the matrix
            if (!output.className.includes("empty")) {
                let [x, y, width, height] = getBounds(output);
                let arrowX = x + width / 2;

                drawArrow(arrowX, y + height, arrowX, matrixHeight);
            }
        }

        //this is a little cheeky, but it's by far the most convenient way to construct an svg
        svg.replaceChildren();
        svg.setAttribute("viewBox", `0 0 ${matrixWidth} ${matrixHeight}`);
        svg.innerHTML = text;
    };

    useEffect(() => {
        window.addEventListener("resize", drawArrows);
        return () => window.removeEventListener("resize", drawArrows);
    }, []);

    /*
    every grid cell contains a "matrix-cell" element, some of which have children - either
    a "matrix-letter" or a "matrix-number".

    we re-render the whole matrix whenever a number changes. this is inefficient but convenient,
    especially when it comes to re-rendering the arrows between cells 
    */

    let cells: (JSX.Element | null)[] = new Array(46).fill(null);

    for (let opI = 0; opI < 4; opI++) {
        let opName = operatorNames[opI];

        let cellI = ((opI * 2) + 1) * 4 + opI;

        let letterRef = useRef(null);
        srcRefs[opName].letter = letterRef;

        cells[cellI] = (
            <div key={cellI} className="matrix-cell">
                <MatrixLetter opName={opName} ref={letterRef} />
            </div>
        );
    }

    let numberVisibilities = [];
    let numberSetters: any = {};

    for (let srcI = 0; srcI < 4; srcI++) {
        let cellX = srcI;
        let srcName = operatorNames[srcI];
        numberSetters[srcName] = {};

        //we use a dstI of 4 to represent the output levels in the bottom row
        for (let dstI = 0; dstI < 5; dstI++) {
            let cellY = (dstI === 4) ? 8 : ((dstI * 2) + 1 - (srcI === dstI ? 1 : 0));
            let cellI = cellX + cellY * 4;

            let isOutput = dstI === 4;
            let dstName = isOutput ? null : operatorNames[dstI];

            let [number, setNumber] = useState(
                isOutput ?
                instrument[srcName].outputLevel :
                instrument[srcName].modulationLevels[dstName!]
            );
            let [dragging, setDragging] = useState(false);

            numberSetters[srcName][dstName || "output"] = setNumber;

            /*
            mouse input
            */

            let dragStart = useRef<{ startY: number, startNumber: number } | null>(null);

            let updateNumber = (newNumber: number) => {
                setNumber(newNumber);

                if (dstName !== null) {
                    instrumentModel.merge(
                        { [srcName]: { modulationLevels: { [dstName]: newNumber }}}
                    );
                } else {
                    instrumentModel.merge({ [srcName]: { outputLevel: newNumber }});
                }
            };

            let onPointerDown = (ev: React.PointerEvent) => {
                if (ev.button === 0) {
                    ev.currentTarget.setPointerCapture(ev.pointerId);
                    dragStart.current = {
                        startY: ev.clientY,
                        startNumber: number,
                    };
                    setDragging(true);
                }
            };

            let onPointerMove = (ev: React.PointerEvent) => {
                if (
                    (ev.buttons & 1) === 1 &&
                    ev.currentTarget.hasPointerCapture(ev.pointerId) &&
                    dragStart.current !== null
                ) {
                    let { startY, startNumber } = dragStart.current;

                    let minNumber = (srcI === dstI) ? -1 : 0;

                    let yDiff = startY - ev.clientY;
                    let newNumber = Math.max(minNumber, Math.min(1, startNumber + yDiff / 110));
                    updateNumber(newNumber);
                }
            };

            let onLostPointerCapture = (ev: React.PointerEvent) => {
                notifyReleasedPointerCapture();

                dragStart.current = null;
                setDragging(false);
            };

            let onPointerUp = (ev: React.PointerEvent) => {
                if (ev.button === 0) {
                    ev.currentTarget.releasePointerCapture(ev.pointerId);
                    onLostPointerCapture(ev);
                }
            };

            let onDoubleClick = (ev: React.MouseEvent) => {
                updateNumber(0);
            };

            /*
            rendering the number...
            */

            let empty = (number === 0 && !dragging);
            numberVisibilities.push(!empty);

            let className = "matrix-number" + (empty ? " empty" : "");
            let text = empty ? "" : (number * 100).toFixed(0);
            let cursor = dragging ? "ns-resize" : "auto";
            let fontSize = (text === "-100") ? "0.85em" : "1em";

            let numberRef = useRef(null);
            srcRefs[srcName][dstName || "output"] = numberRef;

            cells[cellI] = (
                <div
                    key={cellI}
                    className="matrix-cell"
                    style={{ cursor, fontSize }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onLostPointerCapture={onLostPointerCapture}
                    onDoubleClick={onDoubleClick}>
                    <div className={className} ref={numberRef}>
                        <div>{text}</div>
                    </div>
                </div>
            );
        }
    }

    for (let cellI = 0; cellI < cells.length; cellI++) {
        if (cells[cellI] === null) {
            cells[cellI] = (
                <div key={cellI} className="matrix-cell" />
            );
        }
    }

    useEffect(
        () => drawArrows(),
        numberVisibilities
    );

    /*
    synchronisation with the InstrumentModel, when the active instrument changes
    */

    useEffect(() => {
        let callback = () => {
            let instrument = instrumentModel.instrument;

            for (let srcName of operatorNames) {
                let operator = instrument[srcName];

                for (let dstName of ["a", "b", "c", "d", "output"]) {
                    let setNumber: (arg: number) => void = numberSetters[srcName][dstName];

                    if (dstName === "output") {
                        setNumber(operator.outputLevel);
                    } else {
                        setNumber(operator.modulationLevels[dstName as OperatorName]);
                    }
                }
            }
        };

        instrumentModel.addEventListener("activeinstrumentchange", callback);
        return () => instrumentModel.removeEventListener("activeinstrumentchange", callback);
    });

    /*
    bringing it all together...
    */

    return (
        <div className="matrix-container">
            <div className="matrix lcd-panel" ref={matrixRef}>
                {cells}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="matrix-arrows"
                    ref={arrowsRef} />
            </div>
        </div>
    );
}

/*
we factor out MatrixLetter so that we can visualise enabled/disabled operators within
the matrix, without needing to re-render the whole thing on every "mutateinstrument" event
*/

interface MatrixLetterProps {
    opName: OperatorName
}

const MatrixLetter = React.forwardRef(MatrixLetterImpl);

function MatrixLetterImpl(props: MatrixLetterProps, ref: React.ForwardedRef<HTMLDivElement>) {
    let instrumentModel = useContext(InstrumentContext);
    let operator = instrumentModel.instrument[props.opName];

    let [enabled, setEnabled] = useState(operator.enabled);

    useEffect(() => {
        let callback = () => {
            let operator = instrumentModel.instrument[props.opName];
            setEnabled(operator.enabled);
        };

        instrumentModel.addEventListener("mutateinstrument", callback);
        instrumentModel.addEventListener("activeinstrumentchange", callback);
        return () => {
            instrumentModel.removeEventListener("mutateinstrument", callback);
            instrumentModel.removeEventListener("activeinstrumentchange", callback);
        };
    }, [props.opName]);

    let srcX = {
        a: 0,
        b: 512,
        c: 1024,
        d: 1536,
    }[props.opName];

    return (
        <div
            className={"matrix-letter" + (enabled ? "" : " disabled")}
            ref={ref}>
            <img src={`./icons.svg#svgView(viewBox(${srcX},1024,512,512))`} />
        </div>
    );
}
