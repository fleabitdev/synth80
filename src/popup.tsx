import * as React from "./react";
import * as ReactDOM from "./react-dom";
const [useEffect, useRef, useState] = [React.useEffect, React.useRef, React.useState];

/*
the popup dialog which appears when the logo is clicked

we draw a distinction between `displayed` and `hidden` so that we can set "visbility: hidden"
at the end of the opacity transition, to ensure that nothing in the dialog is tab-focusable

we lift up `selectedTab` into a controlled property, so that the App can reset it when the
dialog is opened
*/

export interface PopupProps {
    displayed: boolean,
    hidden: boolean,
    onClose: () => void,
    onCloseTransitionEnd: () => void,

    selectedTab: number,
    onTabChange: (i: number) => void,
}

export function Popup(props: PopupProps) {
    /*
    we want to close the popup when the user presses "esc". rather than trusting html's key
    focus to be sensible, instead we listen for key events on the window
    */

    useEffect(() => {
        let listener = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                props.onClose();
            }
        };

        window.addEventListener("keydown", listener, true);
        return () => window.removeEventListener("keydown", listener, true);
    });

    /*
    rendering...
    */

    let tabs = ["About", "How to Use", "Credits"].map((tabContent, i) => {
        let className = "popup-tab";
        if (i == props.selectedTab) {
            className += " selected";
        }

        return (
            <div
                className={className}
                key={i}
                onClick={() => props.onTabChange(i)}>
                {tabContent}
            </div>
        );
    });

    let className = "";
    if (props.displayed) {
        className += "displayed ";
    }
    if (props.hidden) {
        className += "hidden";
    }

    let content = null;
    switch (props.selectedTab) {
        case 0:
            content = (
                <div>
                    <p>
                        <strong>Synth80</strong>
                        {" is a toy "}
                        <a
                            href="https://en.wikipedia.org/wiki/Frequency_modulation_synthesis"
                            target="_blank">
                            FM synthesiser
                        </a>
                        {", developed by "}
                        <a href="https://fleabit.dev" target="blank">Fleabit</a>.
                    </p>
                    <p>
                        It was created as a portfolio piece in March 2022, to 
                        experiment with skeuomorphic design, React, TypeScript,
                        Sass, and the Web Audio and Web MIDI APIs.
                    </p>
                    <p>
                        {"Source code is available "}
                        <a
                            href="https://github.com/fleabitdev/synth80"
                            target="_blank">
                            on GitHub
                        </a>.
                    </p>
                </div>
            );
            break;

        case 1:
            content = (
                <div>
                    <p>
                        The app is designed for mouse-and-keyboard input.
                    </p>
                    <p>
                        The operators, LFO and FM matrix controls should be intuitive
                        for anybody who is familiar with FM synthesis.
                    </p>
                    <p>
                        The "variations" rack enables adjustment of arbitrary inputs based
                        on arbitrary outputs; for example, modulating an operator's amplitude
                        using the LFO.
                    </p>
                    <p>
                        The on-screen piano can be controlled using the mouse, the
                        keyboard, or by plugging in a MIDI keyboard (currently supported
                        only on Chrome).
                    </p>
                </div>
            );
            break;

        case 2:
            content = (
                <div>
                    <p>
                        {"The user interface design is inspired by the "}
                       <a
                           href="https://www.native-instruments.com/en/products/komplete/synths/fm8/"
                           target="_blank">
                           FM8
                        </a>
                        {" software synthesiser, developed by Native Instruments."}
                    </p>
                    <p>
                        <a
                            href="https://fonts.google.com/specimen/Roboto"
                            target="_blank">
                            Roboto
                        </a>
                        {" is used under the "}
                        <a
                            href="http://www.apache.org/licenses/LICENSE-2.0"
                            target="_blank">
                            Apache License, Version 2.0
                        </a>.
                    </p>
                    <p>
                        {"Some graphics were derived from "}
                        <a
                            href="https://fontawesome.com/"
                            target="_blank">
                            Font Awesome
                        </a>
                        {", under the "}
                        <a
                            href="https://creativecommons.org/licenses/by/4.0/"
                            target="_blank">
                            Creative Commons Attribution 4.0
                        </a>
                        {" license."}
                    </p>
                    <p>
                        {"The "}
                        <a
                            href="https://fontstruct.com/fontstructions/show/1460217/hd44780-3"
                            target="_blank">
                            HD44780
                        </a>
                        {" font was developed by "}
                        <a
                            href="https://fontstruct.com/fontstructors/1137065/logandark"
                            target="_blank">
                            LoganDark
                        </a>
                        {". It's used under the "}
                        <a
                            href="https://creativecommons.org/licenses/by/3.0/"
                            target="_blank">
                            Creative Commons Attribution 3.0
                        </a>
                        {" license."}
                    </p>
                    <p>
                        {"The demo tracks are from the Mutopia Project: "}
                        <a
                            href="https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=835"
                            target="_blank">
                            1
                        </a>
                        {", "}
                        <a
                            href="https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=1398"
                            target="_blank">
                            2
                        </a>
                        {", "}
                        <a
                            href="https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=475"
                            target="_blank">
                            3
                        </a>
                        {", "}
                        <a
                            href="https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=212"
                            target="_blank">
                            4
                        </a>
                    </p>
                </div>
            );
            break;
    }

    return (
        <div
            id="popup-overlay"
            className={className}
            onClick={props.onClose}
            onTransitionEnd={(ev) => {
                if (ev.propertyName === "opacity" && !props.displayed) {
                    props.onCloseTransitionEnd();
                }
            }}
        >
            <div id="popup-shade">
                <div id="popup" onClick={(ev) => ev.stopPropagation()}>
                    <div className="popup-tabs">
                        {tabs}
                    </div>
                    <div className="popup-close" onClick={props.onClose}>
                        <img src="./icons.svg#svgView(viewBox(3584,0,512,512))" />
                    </div>
                    <div className="popup-scrollview">
                        {content}
                    </div>
                </div>
            </div>
        </div>
    );
}
