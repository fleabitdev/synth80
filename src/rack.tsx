import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useContext, useEffect, useRef, useState] = [
    React.useContext, React.useEffect, React.useRef, React.useState
];

import { InstrumentContext, notifyReleasedPointerCapture } from "./app";
import { Operator } from "./operator";
import { Variation } from "./variation";

/*
the rack of operators or variations in the middle column, including
the operators/variations toggle button
*/

export type RackTab = "operators" | "variations";

export interface RackProps {
    tab: RackTab,
    onTabChange: (newTab: RackTab) => void,
}

const MIN_ZOOM = 10;
const MAX_ZOOM = 400;
const MIN_PAN_PIXELS = -8;
export const MAX_SECONDS = 16;

export function Rack(props: RackProps) {
    let instrumentModel = useContext(InstrumentContext);

    let operatorsClassName = (props.tab === "operators") ? "led lit" : "led";
    let variationsClassName = (props.tab === "variations") ? "led lit" : "led";

    let onTabClick = (newTab: RackTab) => {
        if (props.tab !== newTab) {
            props.onTabChange(newTab);
        }
    };

    let [numVariations, setNumVariations] = useState(0);

    let onAddVariationClick = (i: number) => {
        let newVariations = instrumentModel.instrument.variations;
        newVariations[i] = {  
            input: "velocity",
            inputFrom: 0,
            inputTo: 127,

            output: "a",
            outputFrom: 1,
            outputTo: 1,
        };

        instrumentModel.merge({ variations: newVariations });
        setNumVariations(newVariations.filter((v) => v !== null).length);
    };

    let onDeleteVariationClick = (i: number) => {
        let newVariations = instrumentModel.instrument.variations;
        for (let j = i; j < newVariations.length - 1; j++) {
            newVariations[j] = newVariations[j + 1];
        }
        newVariations[newVariations.length - 1] = null;

        instrumentModel.merge({ variations: newVariations });
        setNumVariations(newVariations.filter((v) => v !== null).length);
    };

    useEffect(() => {
        let callback = () => {
            let variations = instrumentModel.instrument.variations;
            setNumVariations(variations.filter((v) => v !== null).length);
        };

        instrumentModel.addEventListener("activeinstrumentchange", callback);
        return () => instrumentModel.removeEventListener("activeinstrumentchange", callback);
    });

    let [envelopeZoom, setEnvelopeZoom] = useState(50);
    let [envelopePan, setEnvelopePan] = useState(MIN_PAN_PIXELS / envelopeZoom);
    let envelopeRef = useRef<HTMLDivElement>(null);

    const ZOOM_RATIO = 1.5;

    let minPan = (zoom: number = envelopeZoom) => {
        return MIN_PAN_PIXELS / zoom;
    };
    let maxPan = (zoom: number = envelopeZoom) => {
        //we use minPan to get a few pixels of extra padding here, independent of the zoom
        return MAX_SECONDS - minPan(zoom) - (envelopeRef.current!.clientWidth / zoom);
    };

    let onEnvelopePanAndZoomChange = (newEnvelopePan: number, newEnvelopeZoom: number) => {
        newEnvelopeZoom = Math.max(MIN_ZOOM, Math.min(newEnvelopeZoom, MAX_ZOOM));
        setEnvelopeZoom(newEnvelopeZoom);

        if (newEnvelopePan < 0) {
            newEnvelopePan *= (envelopeZoom / newEnvelopeZoom);
        }

        //envelopeZoom is out-of-date here..
        setEnvelopePan(
            Math.max(
                minPan(newEnvelopeZoom),
                Math.min(newEnvelopePan, maxPan(newEnvelopeZoom))
            )
        );
    };

    let onZoomInClick = () => {
        onEnvelopePanAndZoomChange(envelopePan, envelopeZoom * ZOOM_RATIO);
    };

    let onZoomOutClick = () => {
        onEnvelopePanAndZoomChange(envelopePan, envelopeZoom / ZOOM_RATIO);
    };

    let rackSlots = null;
    let zoomButtons = null;
    if (props.tab === "operators") {
        rackSlots = [];

        for (let i=0; i<4; i++) {
            rackSlots.push(
                <Operator
                    key={"operator" + i}
                    rackSlot={i}
                    envelopeRef={i === 0 ? envelopeRef : null}
                    envelopePan={envelopePan}
                    envelopeZoom={envelopeZoom}
                    onEnvelopePanAndZoomChange={onEnvelopePanAndZoomChange} />
            );
        }

        rackSlots.push(
            <EmptySlot key="empty4" rackSlot={4} showIcon={false} onIconClick={() => null} />,
        );

        zoomButtons = (
            <>
                <div
                    className="mid-zoom-in button no-left-edge"
                    onClick={onZoomInClick}>
                    <img src="./icons.svg#svgView(viewBox(0,0,512,512))" />
                </div>
                <div
                    className="mid-zoom-out button no-right-edge"
                    onClick={onZoomOutClick}>
                    <img src="./icons.svg#svgView(viewBox(512,0,512,512))" />
                </div>
            </>
        );
    } else {
        let instrument = instrumentModel.instrument;

        rackSlots = [];

        for (let i = 0; i < 5; i++) {
            if (i < numVariations) {
                rackSlots.push(
                    <Variation
                        key={"variation" + i}
                        rackSlot={i}
                        onDelete={() => onDeleteVariationClick(i)} />
                );
            } else {
                rackSlots.push(
                    <EmptySlot
                        key={"empty" + i}
                        rackSlot={i}
                        showIcon={i === numVariations}
                        onIconClick={() => onAddVariationClick(i)} />
                );
            }
        }
    }

    return (
        <div className="mid-column">
            <div
                className="mid-operators button no-right-edge"
                onClick={() => onTabClick("operators")}>
                <div className={operatorsClassName} />
                <div>OPERATORS</div>
            </div>
            <div
                className="mid-variations button no-left-edge"
                onClick={() => onTabClick("variations")}>
                <div className={variationsClassName} />
                <div>VARIATIONS</div>
            </div>
            
            {zoomButtons}

            {rackSlots}
        </div>
    );
}

interface EmptySlotProps {
    rackSlot: number,
    showIcon: boolean,
    onIconClick: () => void,
}

function EmptySlot(props: EmptySlotProps) {
    let icon = null;
    if (props.showIcon) {
        icon = (
            <div className="empty-rack-with-icon">
                <img src="./icons.svg#svgView(viewBox(3584,0,512,512))" />
            </div>
        );
    }

    return (
        <div
            className="rack-slot"
            style={{gridArea: "rk" + props.rackSlot}}
            onClick={(ev) => {
                if (props.showIcon) {
                    props.onIconClick();
                }
            }}>
            {icon}
        </div>
    );
}
