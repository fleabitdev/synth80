import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext, notifyReleasedPointerCapture } from "./app";
import { EnvelopeNode, OperatorName } from "./instrumentModel";
import { MAX_SECONDS } from "./rack";

/*
the operator racks, in the middle column, including their envelope editors and parameter editors
*/

export interface OperatorProps {
    rackSlot: number,

    envelopeRef: React.RefObject<HTMLDivElement> | null,
    envelopePan: number, //seconds
    envelopeZoom: number, //pixels per second
    onEnvelopePanAndZoomChange: (newPan: number, newZoom: number) => void,
}

export function Operator(props: OperatorProps) {
    let instrumentModel = useContext(InstrumentContext);

    let operatorName = ["a", "b", "c", "d"][props.rackSlot] as OperatorName;
    let instrument = instrumentModel.instrument;
    let operator = instrument[operatorName];

    /*
    the enabled/disabled toggle
    */

    let [enabled, setEnabled] = useState(operator.enabled);

    let onEnableButtonClick = () => {
        instrumentModel.merge({ [operatorName]: { enabled: !enabled } });
        setEnabled(!enabled);
    };

    /*
    the gain parameter. the meter is straightforwardly linear
    */

    let [gain, setGain] = useState(operator.gain);

    let onGainFillChange = (fill: number) => {
        let roundedGain = Math.round(fill * 100) / 100;

        instrumentModel.merge({ [operatorName]: { gain: roundedGain } });
        setGain(roundedGain);
    };

    /*
    the ratio parameter. the meter's display is nonlinear: inputs are snapped to 0.0, 0.25, 0.5,
    or the integers; those options are evenly-spaced apart, with linear interpolation between them.
    */

    const MAX_RATIO = 8;
    const RATIO_SNAPS = [0, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8];

    let [ratio, setRatio] = useState(operator.frequencyRatio);

    let ratioFill = 0.0;
    for (let i = 0; i < RATIO_SNAPS.length - 1; i++) {
        if (RATIO_SNAPS[i+1] <= ratio) {
            ratioFill += 1.0 / (RATIO_SNAPS.length - 1);
        } else {
            let progress = (ratio - RATIO_SNAPS[i]) / (RATIO_SNAPS[i+1] - RATIO_SNAPS[i]);
            ratioFill += progress / (RATIO_SNAPS.length - 1);
            
            break;
        }
    }

    let onRatioFillChange = (fill: number, via: "parameter" | "meter" | "reset") => {
        let newRatio;
        if (via === "parameter") {
            let rawIndex = fill * (RATIO_SNAPS.length - 1);
            let index = Math.floor(rawIndex);
            let lerp = rawIndex - index;

            if (index >= RATIO_SNAPS.length - 1) {
                newRatio = RATIO_SNAPS[index];
            } else {
                newRatio = (RATIO_SNAPS[index] * (1 - lerp)) + (RATIO_SNAPS[index + 1] * lerp);
            }
        } else {
            //we only round the ratio when it's being manipulated via the meter
            let index = Math.round(fill * (RATIO_SNAPS.length - 1));
            newRatio = RATIO_SNAPS[index];
        }

        instrumentModel.merge({ [operatorName]: { frequencyRatio: newRatio } });
        setRatio(newRatio);
    };

    /*
    the offset parameter, ranging from -999 to 999 Hz. the meter has a generous region in the
    centre which snaps to zero, and outside of that centre it's cubically interpolated
    */

    const ZERO_WIDTH = 0.06;
    const ZERO_LEFT = 0.5 - ZERO_WIDTH / 2;
    const ZERO_RIGHT = 0.5 + ZERO_WIDTH / 2;

    const MAX_OFFSET = 999;

    let [offset, setOffset] = useState(operator.frequencyOffsetHz);
    
    let offsetFill;
    if (offset === 0) {
        offsetFill = 0.5;
    } else if (offset > 0) {
        offsetFill = ZERO_RIGHT + (1.0 - ZERO_RIGHT) * Math.pow(offset / MAX_OFFSET, 1 / 3);
    } else {
        offsetFill = ZERO_LEFT * (1.0 - Math.pow(-offset / MAX_OFFSET, 1 / 3));
    }

    let onOffsetFillChange = (fill: number) => {
        let newOffset;
        if (fill >= ZERO_LEFT && fill <= ZERO_RIGHT) {
            newOffset = 0;
        } else if (fill < ZERO_LEFT) {
            let halfFill = (ZERO_LEFT - fill) / ZERO_LEFT;
            newOffset = Math.round(-MAX_OFFSET * halfFill * halfFill * halfFill);
        } else {
            let halfFill = (fill - ZERO_RIGHT) / (1.0 - ZERO_RIGHT);
            newOffset = Math.round(MAX_OFFSET * halfFill * halfFill * halfFill);
        }

        instrumentModel.merge({ [operatorName]: { frequencyOffsetHz: newOffset } });
        setOffset(newOffset);
    };

    /*
    the envelope editor, rendered using a similar approach to the fm matrix (see matrix.tsx).
    */

    interface Drag {
        startX: number,
        startY: number,
        op: DragOp,
    }

    type DragOp = {
        type: "dragView",
        startZoom: number,
        startPan: number,
        startSeconds: number,
    } | {
        type: "dragNode",
        nodeI: number,
        startSeconds: number,
        startLevel: number,
        startEnvelope: readonly [EnvelopeNode, EnvelopeNode, EnvelopeNode, EnvelopeNode],
    };

    let drag = useRef<Drag | null>(null);

    let svgRef = useRef<SVGSVGElement>(null);
    let [envelope, setEnvelope] = useState(operator.envelope);

    const AXIS_HEIGHT = 13;
    const GRID_PAD = 3;
    const NODE_SIZE = 6;
    const HOVER_DISTANCE = 3;

    //getBoundingClientRect is quite slow on firefox (10ms?), because it might force a layout.
    //we can't call it on every draw. instead, we cache the svg's size, and only update it when
    //the envelope editor's size might have changed (specifically, on window.resize)
    let svgWidthCache = useRef<number | null>(null);
    let svgHeightCache = useRef<number | null>(null);

    //returns [x, y, w, h], measured in pixels
    let nodeCoords = (node: EnvelopeNode) => {
        let x = (node.seconds - props.envelopePan) * props.envelopeZoom - NODE_SIZE / 2;

        if (svgHeightCache.current === null) {
            svgHeightCache.current = svgRef.current!.clientHeight;
        }
        let svgHeight = svgHeightCache.current;

        let yRange = svgHeight - AXIS_HEIGHT - NODE_SIZE - (GRID_PAD * 2);
        let y = svgHeight - (NODE_SIZE + GRID_PAD + yRange * node.level);

        return [x, y, NODE_SIZE, NODE_SIZE];
    };

    let drawEnvelope = () => {
        let svg = svgRef.current!;
        let textToJoin = [];
        textToJoin.push(`
            <style>
                .hover-region:hover + .inner,
                .inner:hover {
                    fill: #505549;
                }

                .inner.dragging {
                    fill: #222;
                }
            </style>
        `);

        if (svgWidthCache.current === null || svgHeightCache.current === null) {
            let {
                top: svgTop,
                bottom: svgBottom,
                left: svgLeft,
                right: svgRight,
            } = svg.getBoundingClientRect();

            //getBoundingClientRect includes borders, which isn't what we want here
            let computedStyle = getComputedStyle(svg);

            svgTop += parseFloat(computedStyle.borderTopWidth);
            svgBottom -= parseFloat(computedStyle.borderBottomWidth);
            svgLeft += parseFloat(computedStyle.borderLeftWidth);
            svgRight -= parseFloat(computedStyle.borderRightWidth);

            svgWidthCache.current = svgRight - svgLeft;
            svgHeightCache.current = svgBottom - svgTop;
        }

        let svgWidth = svgWidthCache.current;
        let svgHeight = svgHeightCache.current;

        let gridTopY = AXIS_HEIGHT + GRID_PAD + NODE_SIZE / 2;
        let gridBottomY = svgHeight - GRID_PAD - NODE_SIZE / 2;

        /*
        draw the seconds axis (above the envelope) and the grid (behind the envelope)
        */

        function drawLine(
            x1: number,
            y1: number,
            x2: number,
            y2: number,
            strokeWidth: number,
            alpha: number = 1,
        ) {
            textToJoin.push(`
                <line
                    x1="${x1}"
                    y1="${y1}"
                    x2="${x2}"
                    y2="${y2}"
                    stroke="rgba(34, 34, 34, ${alpha})"
                    stroke-width="${strokeWidth}" />
            `);
        }

        function drawRect(
            x: number,
            y: number,
            width: number,
            height: number,
            fill: string,
            className: string = "",
        ) {
            textToJoin.push(`
                <rect
                    class="${className}"
                    x="${x}"
                    y="${y}"
                    width="${width}"
                    height="${height}"
                    fill="${fill}" />
            `);
        }

        drawLine(0, AXIS_HEIGHT, svgWidth, AXIS_HEIGHT, 1, 0.3);

        drawLine(0, gridTopY, svgWidth, gridTopY, 1, 0.3);
        drawLine(0, gridBottomY, svgWidth, gridBottomY, 1, 0.3);

        for (
            let secs = Math.floor(props.envelopePan);
            (secs - props.envelopePan) * props.envelopeZoom < svgWidth + 1;
            secs++
        ) {
            for (let fraction of [0.25, 0.5, 0.75, 1]) {
                let lineX = (secs + fraction - props.envelopePan) * props.envelopeZoom;

                drawLine(
                    lineX,
                    gridTopY + 0.5,
                    lineX,
                    gridBottomY - 0.5,
                    1,
                    (fraction === 1) ? 0.3 : 0.15,
                );
            }
        }

        let secsIncrement = 0.25;
        if (props.envelopeZoom < 20) {
            secsIncrement = 2;
        } else if (props.envelopeZoom < 50) {
            secsIncrement = 1;
        } else if (props.envelopeZoom < 100) {
            secsIncrement = 0.5;
        }

        for (
            let secs = 0;
            (secs - props.envelopePan) * props.envelopeZoom < svgWidth + 10;
            secs += secsIncrement
        ) {
            let alpha = ((secs % 1) !== 0) ? 0.5 : 1;

            textToJoin.push(`
                <text
                    x="${(secs - props.envelopePan) * props.envelopeZoom}"
                    y="${(AXIS_HEIGHT) * 0.8}"
                    text-anchor="middle"
                    font-size="${(AXIS_HEIGHT) * 0.7}px"
                    font-family="Roboto Subset"
                    font-weight="500"
                    fill="rgba(34, 34, 34, ${alpha})">
                    ${secs}
                </text>
            `);
        }

        /*
        draw the envelope itself
        */

        const STROKE_THICKNESS = 1.4;

        let polygonPoints = [];

        for (let i = 0; i < 4; i++) {
            const ALPHA = 1;

            let [x, y] = nodeCoords(envelope[i]);
            let midX = x + NODE_SIZE / 2;
            let midY = y + NODE_SIZE / 2;

            if (i === 0) {
                polygonPoints.push(`${midX},${gridBottomY}`);
            }

            polygonPoints.push(`${midX},${midY}`);

            if (i === 3) {
                polygonPoints.push(`${midX},${gridBottomY}`);
            }
        }

        textToJoin.push(`
            <polygon
                points="${polygonPoints.join(" ")}"
                fill="rgba(34, 34, 34, 0.25)"
                stroke="#222"
                stroke-width="${STROKE_THICKNESS}" />
        `);

        for (let i = 0; i < 4; i++) {
            let [x, y, width, height] = nodeCoords(envelope[i]);

            let innerClass = "inner";
            if (
                drag.current !== null &&
                drag.current.op.type === "dragNode" &&
                drag.current.op.nodeI === i
            ) {
                innerClass += " dragging";
            }

            drawRect(x, y, width, height, "#222", "outer");
            drawRect(
                x - HOVER_DISTANCE,
                y - HOVER_DISTANCE,
                width + HOVER_DISTANCE * 2,
                height + HOVER_DISTANCE * 2,
                "rgba(0, 0, 0, 0.0)",
                "hover-region",
            );
            drawRect(
                x + STROKE_THICKNESS,
                y + STROKE_THICKNESS,
                width - STROKE_THICKNESS * 2,
                height - STROKE_THICKNESS * 2,
                "#6e7664",
                innerClass,
            );
        }

        /*
        submit the new svg content
        */

        svg.replaceChildren();
        svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
        svg.innerHTML = textToJoin.join("");
    };

    let drawDependencies = [props.envelopePan, props.envelopeZoom];
    for (let i = 0; i < 4; i++) {
        drawDependencies.push(envelope[i].seconds);
        drawDependencies.push(envelope[i].level);
    }

    useEffect(() => {
        drawEnvelope();

        let callback = () => {
            svgWidthCache.current = null;
            svgHeightCache.current = null;
            drawEnvelope();
        };

        window.addEventListener("resize", callback);
        return () => window.removeEventListener("resize", callback);
    }, drawDependencies);

    let onEnvelopePointerDown = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.setPointerCapture(ev.pointerId);

            let svgLeft = svgRef.current!.getBoundingClientRect().left;
            let svgTop= svgRef.current!.getBoundingClientRect().top;

            let startSeconds = 
                props.envelopePan + (ev.clientX - svgLeft) / props.envelopeZoom;

            /*
            we prioritise nodes with higher indices, to prevent editing difficulties if
            multiple nodes overlap at `time = 0s`. we'll still see those difficulties if
            multiple nodes are set to the *maximum* time-value, but that's unlikely.

            we want to use the browser's :hover styling for good responsiveness, but this means
            that when two nodes are very close to one another, we have to prioritise selecting
            the one with the highest index (even if the mouse is directly over another node),
            for consistency with the :hover styling. we compensate for this by keeping
            HOVER_DISTANCE relatively small; no more than a few pixels.
            */

            let nodeUnderMouse = null;
            for (let i = 0; i < 4; i++) {
                let relX = ev.clientX - svgLeft;
                let relY = ev.clientY - svgTop;

                let [x, y, width, height] = nodeCoords(envelope[i]);

                if (
                    relX >= x - HOVER_DISTANCE &&
                    relX <= x + width + HOVER_DISTANCE &&
                    relY >= y - HOVER_DISTANCE &&
                    relY <= y + height + HOVER_DISTANCE
                ) {
                    nodeUnderMouse = i;
                }
            }

            if (nodeUnderMouse === null) {
                drag.current = {
                    startX: ev.clientX,
                    startY: ev.clientY,
                    op: {
                        type: "dragView",
                        startZoom: props.envelopeZoom,
                        startPan: props.envelopePan,
                        startSeconds,
                    },
                };
            } else {
                drag.current = {
                    startX: ev.clientX,
                    startY: ev.clientY,
                    op: {
                        type: "dragNode",
                        nodeI: nodeUnderMouse,
                        startSeconds: envelope[nodeUnderMouse].seconds,
                        startLevel: envelope[nodeUnderMouse].level,
                        startEnvelope: [...envelope],
                    },
                };

                drawEnvelope();
            }
        }
    };

    let onEnvelopePointerMove = (ev: React.PointerEvent) => {
        if (
            (ev.buttons & 1) === 1 &&
            ev.currentTarget.hasPointerCapture(ev.pointerId) &&
            drag.current !== null
        ) {
            if (drag.current.op.type === "dragView") {
                let { startX, startY, op: { startZoom, startPan, startSeconds } } = drag.current;

                let yDiff = startY - ev.clientY;
                let newZoom = startZoom * Math.pow(2, yDiff / 40);

                //our goal is to keep the same time-coordinate centered on the mouse's x-coord
                let svgLeft = svgRef.current!.getBoundingClientRect().left;
                let targetX = ev.clientX - svgLeft;
                let targetSecondsOffset = targetX / newZoom;
                let newPan = startSeconds - targetSecondsOffset;

                props.onEnvelopePanAndZoomChange(newPan, newZoom);
            }
            else if (drag.current.op.type === "dragNode") {
                let {
                    startX,
                    startY,
                    op: { nodeI, startSeconds, startLevel, startEnvelope }
                } = drag.current;

                //convert the mouse coordinates into a new level and seconds
                if (svgHeightCache.current === null) {
                    svgHeightCache.current = svgRef.current!.clientHeight;
                }
                let svgHeight = svgHeightCache.current;
                let yRange = svgHeight - AXIS_HEIGHT - NODE_SIZE - (GRID_PAD * 2);

                let rawLevel = startLevel - (ev.clientY - startY) / yRange;
                let newLevel = Math.max(0.0, Math.min(1.0, rawLevel));

                let rawSeconds = startSeconds + (ev.clientX - startX) / props.envelopeZoom;
                let newSeconds = Math.max(0.0, Math.min(MAX_SECONDS, rawSeconds));

                //construct the new envelope (taking care not to mutate the original)
                let newEnvelope: typeof envelope = [...startEnvelope];
                newEnvelope[nodeI] = {
                    seconds: newSeconds,
                    level: newLevel,
                };

                for (let i = 0; i < nodeI; i++) {
                    if (newSeconds < startEnvelope[i].seconds) {
                        newEnvelope[i] = {
                            seconds: newSeconds,
                            level: startEnvelope[i].level,
                        };
                    }
                }

                for (let i = nodeI + 1; i < 4; i++) {
                    if (newSeconds > startEnvelope[i].seconds) {
                        newEnvelope[i] = {
                            seconds: newSeconds,
                            level: startEnvelope[i].level,
                        };
                    }
                }

                setEnvelope(newEnvelope);
                instrumentModel.merge({ [operatorName]: { envelope: newEnvelope } });
            }
        }
    };

    let onEnvelopeLostPointerCapture = (ev: React.PointerEvent) => {
        notifyReleasedPointerCapture();

        drag.current = null;
        drawEnvelope();
    };

    let onEnvelopePointerUp = (ev: React.PointerEvent) => {
        if (ev.button === 0 && ev.currentTarget.hasPointerCapture(ev.pointerId)) {
            ev.currentTarget.releasePointerCapture(ev.pointerId);
            onEnvelopeLostPointerCapture(ev);
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
            
            let operatorName = ["a", "b", "c", "d"][props.rackSlot] as OperatorName;
            let instrument = instrumentModel.instrument;
            let operator = instrument[operatorName];

            setEnabled(operator.enabled);
            setGain(operator.gain);
            setRatio(operator.frequencyRatio);
            setOffset(operator.frequencyOffsetHz);
            setEnvelope(operator.envelope);
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

    return (
        <div className="rack-slot" style={{gridArea: "rk" + props.rackSlot}}>
            <div className={"rack-operator plastic-panel" + (enabled ? "" : " disabled")}>
                <div className="rack-letter-container">
                    <img
                        className="rack-letter"
                        src={`./icons.svg#svgView(viewBox(${props.rackSlot * 512},512,512,512))`}
                    />
                </div>
                <div className="rack-button-container">
                    <div className="button" onClick={onEnableButtonClick}>
                        <div className={enabled ? "led lit" : "led"} />
                    </div>
                </div>

                <div
                    className="rack-envelope lcd-panel"
                    ref={props.envelopeRef}
                    onPointerDown={onEnvelopePointerDown}
                    onPointerMove={onEnvelopePointerMove}
                    onLostPointerCapture={onEnvelopeLostPointerCapture}
                    onPointerUp={onEnvelopePointerUp}>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="rack-envelope-editor"
                        ref={svgRef} />
                </div>

                <Parameter
                    label="GAIN"
                    units=""
                    value={gain}
                    decimalPlaces={2}
                    fill={gain}
                    defaultFill={1}
                    onFillChange={onGainFillChange} />
                <Parameter
                    label="RATIO"
                    units="X"
                    value={ratio}
                    decimalPlaces={2}
                    fill={ratioFill}
                    defaultFill={3.0 / (RATIO_SNAPS.length - 1)}
                    onFillChange={onRatioFillChange} />
                <Parameter
                    label="OFFSET"
                    units="Hz"
                    value={offset}
                    decimalPlaces={0}
                    fill={offsetFill}
                    defaultFill={0.5}
                    onFillChange={onOffsetFillChange} />
            </div>
        </div>
    );
}

export interface ParameterProps {
    label: string,
    units: string,

    value: number,
    decimalPlaces: number,

    /*
    the fill level of the meter. should range from 0.0 to 1.0. we don't modify the value
    directly; instead, we report linear changes in the meter fill, which the parent can
    translate to a new value, perhaps non-linearly.

    clicking and dragging on the textbox also triggers onFillChange, so that the client isn't
    writing the same linear-to-conversion code twice. the fill-change amount is directly
    proportional to the vertical distance moved by the mouse.
    */

    fill: number,
    defaultFill: number,
    onFillChange: (newFill: number, via: "parameter" | "meter" | "reset") => void,
}

export function Parameter(props: ParameterProps) {
    /*
    the text field

    we could consider fm8-style variable precision depending on how far left/right the initial
    lmb-down event is. always found it a bit clumsy and frustrating, though
    */

    let [parameterCursor, setParameterCursor] = useState<"auto" | "ns-resize">("auto");
    let parameterStart = useRef<{ startY: number, startFill: number } | null>(null);

    let onParameterPointerDown = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            parameterStart.current = {
                startY: ev.clientY,
                startFill: props.fill,
            };
            setParameterCursor("ns-resize");
        }
    };

    let onParameterPointerMove = (ev: React.PointerEvent) => {
        if (
            (ev.buttons & 1) === 1 &&
            ev.currentTarget.hasPointerCapture(ev.pointerId) &&
            parameterStart.current !== null
        ) {
            let { startY, startFill } = parameterStart.current;

            let yDiff = startY - ev.clientY;
            let newFill = Math.max(0.0, Math.min(1.0, startFill + yDiff / 120));
            props.onFillChange(newFill, "parameter");
        }
    };

    let onParameterLostPointerCapture = (ev: React.PointerEvent) => {
        notifyReleasedPointerCapture();

        parameterStart.current = null;
        setParameterCursor("auto");
    };

    let onParameterPointerUp = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.releasePointerCapture(ev.pointerId);
            onParameterLostPointerCapture(ev);
        }
    };

    /*
    the meter
    */
    
    let updateMeter = (ev: React.PointerEvent) => {
        let { left, right } = ev.currentTarget.getBoundingClientRect();

        let mouseX = ev.clientX;
        let ratio = Math.max(0.0, Math.min(1.0, (mouseX - left) / (right - left)));

        props.onFillChange(ratio, "meter");
    };

    let onMeterPointerDown = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.setPointerCapture(ev.pointerId);

            updateMeter(ev);
        }
    };

    let onMeterPointerMove = (ev: React.PointerEvent) => {
        if ((ev.buttons & 1) === 1 && ev.currentTarget.hasPointerCapture(ev.pointerId)) {
            updateMeter(ev);
        }
    };

    let onMeterPointerUp = (ev: React.PointerEvent) => {
        if (ev.button === 0) {
            ev.currentTarget.releasePointerCapture(ev.pointerId);
            notifyReleasedPointerCapture();
        }
    };

    let onMeterLostPointerCapture = (ev: React.PointerEvent) => {
        notifyReleasedPointerCapture();
    };

    /*
    we process double-click events originating from any part of the control,
    including the label
    */

    let onDoubleClick = (ev: React.MouseEvent) => {
        if (props.fill !== props.defaultFill) {
            props.onFillChange(props.defaultFill, "reset");
        }
    };

    /*
    rendering...
    */

    return (
        <>
            <div
                className="label"
                onDoubleClick={onDoubleClick}>
                {props.label}
            </div>

            <div
                className="parameter lcd-panel small"
                style={{ cursor: parameterCursor }}
                onPointerDown={onParameterPointerDown}
                onPointerMove={onParameterPointerMove}
                onPointerUp={onParameterPointerUp}
                onLostPointerCapture={onParameterLostPointerCapture}
                onDoubleClick={onDoubleClick}>
                <div className="parameter-with-units">
                    <span className="parameter-value">
                        {props.value.toFixed(props.decimalPlaces)}
                    </span>
                    <span className="parameter-units">{props.units}</span>
                </div>
            </div>

            <div
                className="meter"
                onPointerDown={onMeterPointerDown}
                onPointerMove={onMeterPointerMove}
                onPointerUp={onMeterPointerUp}
                onLostPointerCapture={onMeterLostPointerCapture}
                onDoubleClick={onDoubleClick}>
                <div className="meter-channel">
                    <div className="meter-fill" style={{width: `${props.fill * 100}%`}} />
                </div>
            </div>
        </>
    );
}
