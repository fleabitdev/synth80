import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [createContext, useEffect, useRef, useState] = [
    React.createContext, React.useEffect, React.useRef, React.useState
];

import { DemoTracks } from "./demoTracks";
import { InstrumentList } from "./instrumentList";
import { Lfo } from "./lfo";
import { Matrix } from "./matrix";
import { MidiFile, parseMidi } from "./midiFile";
import { Piano } from "./piano";
import { Popup } from "./popup";
import { Rack, RackTab } from "./rack";
import { Waveform } from "./waveform";

//caution: if you import specific names but don't use them, tsc won't actually run the module
import { InstrumentModel } from "./instrumentModel";
import { MusicModel } from "./musicModel";
import { Mixer } from "./mixer";

/*
initialising global objects...
*/

let instrumentModel: InstrumentModel | null = null;
let musicModel: MusicModel | null = null;
let mixer: Mixer | null = null;
let demoTracks: MidiFile[] = [];

let startupError: Error | null = null;

try {
    instrumentModel = new InstrumentModel();
    musicModel = new MusicModel();
    mixer = new Mixer(instrumentModel, musicModel);
} catch (err) {
    if (err instanceof Error) {
        startupError = err;
    }
}

export const InstrumentContext = createContext(instrumentModel!);

/*
the rendering function
*/

function App(props: {}) {
    /*
    managing the popup dialog (see popup.tsx)
    */

    let [popupDisplayed, setPopupDisplayed] = useState(false);
    let [popupHidden, setPopupHidden] = useState(true);
    let [popupSelectedTab, setPopupSelectedTab] = useState(0);

    function deselectAllText() {
        let selection = window.getSelection();
        if (selection !== null) {
            selection.removeAllRanges();
        }
    }

    let onPopupClose = () => {
        deselectAllText();
        setPopupDisplayed(false);
    };

    let onPopupCloseTransitionEnd = () => {
        setPopupHidden(true);

        mixer!.globalMute = false;
        musicModel!.globalMute = false;
    };

    let onBrandingClick = () => {
        deselectAllText();
        setPopupSelectedTab(0);
        setPopupDisplayed(true);
        setPopupHidden(false);

        mixer!.globalMute = true;
        musicModel!.globalMute = true;
    };

    /*
    state for the selected tab of the rack in the middle column (see rack.tsx)
    */

    let [rackTab, setRackTab] = useState<RackTab>("operators");

    /*
    rendering...
    */

    return (
        <InstrumentContext.Provider value={instrumentModel!}>
            <div
                id="app-grid"
                className={popupDisplayed ? "obscured" : ""}
                onDragStart={(ev) => ev.preventDefault()}>
                <div className="branding-cell">
                    <div id="branding" onClick={onBrandingClick}>
                        <img className="logo" src="./logo.svg" />
                    </div>
                </div>
                <div className="left-column">
                    <div className="side-panel plastic-panel">
                        <div className="heading">
                            <div className="heading-label">INSTRUMENTS</div>
                            <div className="heading-line" />
                        </div>
                        <InstrumentList />
                        <div className="heading">
                            <div className="heading-label">DEMO TRACKS</div>
                            <div className="heading-line" />
                        </div>
                        <DemoTracks demoTracks={demoTracks} musicModel={musicModel!} />
                    </div>
                </div>
                <Rack
                    tab={rackTab}
                    onTabChange={(newTab: RackTab) => setRackTab(newTab)} />
                <div className="right-column">
                    <div className="side-panel plastic-panel">
                        <div className="heading">
                            <div className="heading-label">FM MATRIX</div>
                            <div className="heading-line" />
                        </div>
                        <Matrix />
                        <div className="heading">
                            <div className="heading-label">WAVEFORM</div>
                            <div className="heading-line" />
                        </div>
                        <Waveform />
                        <div className="heading">
                            <div className="heading-label">LFO</div>
                            <div className="heading-line" />
                        </div>
                        <Lfo />
                    </div>
                </div>
                <div className="piano-cell">
                    <Piano noteOffset={0} musicModel={musicModel!} />
                </div>
            </div>
            <Popup
                displayed={popupDisplayed}
                hidden={popupHidden}
                onClose={onPopupClose}
                onCloseTransitionEnd={onPopupCloseTransitionEnd}
                selectedTab={popupSelectedTab}
                onTabChange={(i) => setPopupSelectedTab(i)} />
        </InstrumentContext.Provider>
    );
}

/*
when performing any captured mouse movement (e.g. dragging a parameter or meter value), if the
mouse is released over a button (or an lfo waveform, etc.), that button will receive a spurious
"click" event in firefox. this is a known bug (bugzilla.mozilla.org/show_bug.cgi?id=1694436).

as a workaround, we globally suppress any "click" event which happens in the few moments after
we release pointer capture. this requires us to manually fire a global notification that pointer
capture has just been released (by calling notifyReleasedPointerCapture()).
*/

let lastReleasedPointerCapture = performance.now();

export function notifyReleasedPointerCapture() {
    lastReleasedPointerCapture = performance.now();
}

window.addEventListener(
    "click",
    (ev: MouseEvent) => {
        if ((performance.now() - lastReleasedPointerCapture) < 100) {
            ev.stopPropagation();
        }
    },
    true,
);

/*
we want to delay first render until all images and fonts have been preloaded, to prevent pop-in.
to avoid repeating ourselves, we inspect the <link rel="preload"> elements within <head>.

note: when testing this, make sure "disable cache" isn't enabled in devtools. there's currently
also a bug in firefox where it treats svg fragment identifiers as distinct resources, causing
a few images to pop in after the app is first presented.
*/

let promisedResources: Promise<any>[] = [];

let nextDemoTrackI = 0;

for (let child of document.head.children) {
    //for each <link rel="preload"> element...
    if (child instanceof HTMLLinkElement && child.rel === "preload") {
        if (child.as === "image") {
            
            //preload an image
            let image = new Image();
            image.src = child.href;

            let href = child.href;
            promisedResources.push(image.decode());
        
        } else if (child.as === "fetch" && child.href.endsWith(".mid")) {

            //preload and pre-parse a midi file
            const demoTrackI = nextDemoTrackI;
            nextDemoTrackI += 1;

            let promise = fetch(child.href)
                .then((resp) => {
                    if (resp.ok) {
                        return resp.arrayBuffer();
                    } else {
                        throw new Error(
                            `unable to fetch resource ${resp.url}: ` +
                            `${resp.status} ${resp.statusText}`
                        );
                    }
                })
                .then((arrayBuffer) => {
                    let label = (child as HTMLElement).dataset.label!;
                    demoTracks[demoTrackI] = parseMidi(label, arrayBuffer);
                });

            promisedResources.push(promise);
        }
    }
}

for (let fontFace of document.fonts) {
    //preload a font
    promisedResources.push(fontFace.load());
}

//introduce an artificial startup delay, for testing
//promisedResources.push(new Promise((resolve, _) => setTimeout(resolve, 3000)));

//the fade-in transition only occurs if loading takes more than 0.5s
let revealAppWithTransition = false;
window.setTimeout(() => revealAppWithTransition = true, 500);

/*
bringing it all together: wait until all resources have loaded, then render the App and reveal
it (perhaps with a fade-from-black animation). if global initialisation has already failed,
or if any errors are thrown during that process, show an error message instead.
*/

let errorReported = false;

function reportError(err: Error) {
    if (!errorReported) {
        let loadingDiv = document.querySelector("#loading-or-error .loading") as HTMLElement;
        let errorDiv = document.querySelector("#loading-or-error .error") as HTMLElement;
        let nameSpan = document.querySelector("#loading-or-error .error-name") as HTMLElement;
        let messageSpan = document.querySelector("#loading-or-error .error-message") as HTMLElement;
        
        loadingDiv.style.display = "none";
        errorDiv.style.display = "block";
        nameSpan.innerText = err.name + ": ";
        messageSpan.innerText = err.message;

        errorReported = true;
    }
}

function render() {
    try {
        ReactDOM.render(<App />, document.getElementById("app"));

        //reveal the #app
        let app = document.getElementById("app")!;

        if (!revealAppWithTransition) {
            app.style.transition = "none";
        }

        app.style.removeProperty("display");

        //start the #app's fade-from-black animation (if this is done
        //synchronously, the transition won't trigger)
        window.setTimeout(() => {
            app.className = "";
        }, 0);

        //hide the loading/error message
        document.body.removeChild(document.getElementById("loading-or-error")!);
    } catch (err: any) {
        console.log("error during react rendering");
        console.log(err);

        reportError(err);
    }
}

if (startupError === null) {
    Promise.all(promisedResources)
        .then((_) => {
            render();
        })
        .catch((err) => {
            console.log("error when loading resources");
            console.log(err);
            
            reportError(err);
        });
} else {
    reportError(startupError);
}
