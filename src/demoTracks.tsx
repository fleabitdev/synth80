import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useEffect, useRef, useState] = [React.useEffect, React.useRef, React.useState];

import { MidiFile } from "./midiFile";
import { MusicModel } from "./musicModel";

/*
the user interface for selecting and playing/stopping a demo track, in the left column
*/

export interface DemoTracksProps {
    demoTracks: MidiFile[],
    musicModel: MusicModel,
}

export function DemoTracks(props: DemoTracksProps) {
    let [trackI, setTrackI] = useState(0);
    let [playing, setPlaying] = useState(false);

    let onDemoStop = () => {
        setPlaying(false);
    };

    useEffect(() => {
        props.musicModel.addEventListener("demostop", onDemoStop);

        return () => {
            props.musicModel.removeEventListener("demostop", onDemoStop);
        };
    });

    let onTrackChange = (offset: number) => {
        //euclidean remainder
        let n = props.demoTracks.length;
        let newTrackI = (((trackI + offset) % n) + n) % n;

        setTrackI(newTrackI);
        setPlaying(false);

        props.musicModel.stopDemoTrack();
    };

    let onPlayClick = () => {
        if (playing) {
            props.musicModel.stopDemoTrack();
        } else {
            props.musicModel.playDemoTrack(props.demoTracks[trackI]);
        }

        setPlaying(!playing);
    };

    return (
        <div className="demo-cell">
            <div className="demo-prev button no-right-edge" onClick={() => onTrackChange(-1)}>
                <img src="./icons.svg#svgView(viewBox(1024,0,512,512))" />
            </div>
            <div className="demo-next button no-left-edge" onClick={() => onTrackChange(1)}>
                <img src="./icons.svg#svgView(viewBox(1536,0,512,512))" />
            </div>
            <div className="demo-play button" onClick={onPlayClick}>
                <div className={"led" + (playing ? " lit" : "")} />
                <div>PLAY</div>
            </div>
            <div className="lcd-panel demo-name">
                {props.demoTracks[trackI].label.toUpperCase()}
            </div>
        </div>
    );
}
