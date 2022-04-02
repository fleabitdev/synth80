/*
this file contains the data model for instruments.

this includes the instrument list, the active instrument, and for each instrument its name,
operator parameters, envelopes, variations, fm matrix, and lfo settings.

this represents most of the synthesiser's non-ui state, with the exception of state related
to musical-note input (see musicModel.ts).

the instrument data model is viewed and mutated by the ui, and it modifies how the Mixer renders
any ongoing notes. we provide a single, coarse "mutateinstrument" event whenever any instrument
parameters are changed; this is used by the Mixer to adjust any ongoing voices, and also used by
the spectrum viewer (see below). we don't need to provide more fine-grained notifications, because
there's generally a 1-to-1 relationship between ui components and parameters, so the component
can just mirror the parameter's value via useState(). when the active instrument changes, we fire
an "activeinstrumentchange" event which prompts various components to sync with the new instrument.
*/

export interface Instrument {
    name: string,

    a: Operator,
    b: Operator,
    c: Operator,
    d: Operator,

    variations: Variations,

    lfoWave: LfoWave,
    lfoDelaySeconds: number,
    lfoAttackSeconds: number,
    lfoFrequencyHz: number,
}

export interface Operator {
    enabled: boolean,
    gain: number,
    frequencyRatio: number,
    frequencyOffsetHz: number,

    //each node's `seconds` value must be >= its predecessor
    envelope: [EnvelopeNode, EnvelopeNode, EnvelopeNode, EnvelopeNode],

    modulationLevels: {
        a: number,
        b: number,
        c: number,
        d: number,
    },
    outputLevel: number,
}

export interface EnvelopeNode {
    seconds: number,
    level: number,
}

export type OperatorName = "a" | "b" | "c" | "d";

export type LfoWave = "sine" | "triangle" | "square" | "sawtooth";

export interface Variation {
    input: VariationInput,
    inputFrom: number,
    inputTo: number,

    output: VariationOutput,
    outputFrom: number,
    outputTo: number,
}

export type VariationInput = "note" | "velocity" | "lfo" | "mod";
export type VariationOutput = "lfo" | OperatorName;

export type Variations = [
    Variation | null,
    Variation | null,
    Variation | null,
    Variation | null,
    Variation | null,
];

function newEmptyOperator(): Operator {
    return {
        enabled: false,
        gain: 1,
        frequencyRatio: 1,
        frequencyOffsetHz: 0,

        envelope: [
            { seconds: 0, level: 0 },
            { seconds: 0, level: 1 },
            { seconds: 1, level: 1 },
            { seconds: 1, level: 0 },
        ],

        modulationLevels: { a: 0, b: 0, c: 0, d: 0 },
        outputLevel: 0,
    };
}

function newEmptyInstrument(): Instrument {
    return {
        name: "",

        a: newEmptyOperator(),
        b: newEmptyOperator(),
        c: newEmptyOperator(),
        d: newEmptyOperator(),

        variations: [null, null, null, null, null],

        lfoWave: "sine",
        lfoDelaySeconds: 0,
        lfoAttackSeconds: 0,
        lfoFrequencyHz: 1,
    };
}

function deepCloneInstrument(instrument: Instrument) {
    function deepClone<T>(x: T): T {
        if (x instanceof Array) {
            let result = [];
            for (let element of x) {
                result.push(deepClone(element));
            }

            //dynamic assertion that the types match
            return (result as unknown as T);
        }

        if (x instanceof Object) {
            let result: { [key: string | number]: any } = {};
            let erasedX: { [key: string | number]: any } = x;
            for (let key of Object.keys(erasedX)) {
                result[key] = deepClone(erasedX[key]);
            }

            //dynamic assertion that the types match
            return (result as unknown as T);
        }

        return x;
    }

    return deepClone(instrument);
}

/*
we express instrument changes as a "partial instrument" which can be merged onto an existing one

mergeInstruments() returns a newly-allocated Instrument. its second result will be `true` if
the result deeply compares unequal to the `instrument` argument.
*/

type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type PartialInstrument = DeepPartial<Instrument>;
export type PartialVariation = DeepPartial<Variation>;

function deepMerge(target: any, src: any): [any, boolean] {
    /*
    this api can't add or remove properties/elements from the destination, it can only
    mutate them. variably-sized arrays and optional properties should not be used.

    if a property or element is missing from `src`, it's copied from `target` unmodified.
    */

    if (target instanceof Array) {
        if (!(src instanceof Array)) {
            throw new Error("expected array when merging instruments");
        } else {
            let result = [];
            let mutated = false;
            for (let i = 0; i < target.length; i++) {
                if (src[i] !== undefined) {
                    let [newElement, elementMutated] = deepMerge(target[i], src[i]);
                    result.push(newElement);
                    mutated = (mutated || elementMutated);
                } else {
                    result.push(target[i]);
                }
            }

            return [result, mutated];
        }
    }

    if (target instanceof Object || target === null) {
        if (!(src instanceof Object) && src !== null) {
            throw new Error("expected object when merging instruments");
        }

        if (src !== null && target !== null) {
            let result: { [key: string | number]: any } = {};
            let mutated = false;
            for (let key of Object.keys(target)) {
                if (src[key] !== undefined) {
                    let [newElement, elementMutated] = deepMerge(target[key], src[key]);
                    result[key] = newElement;
                    mutated = (mutated || elementMutated);
                } else {
                    result[key] = target[key];
                }
            }

            return [result, mutated];
        } else {
            return [src, target !== src];
        }
    }

    return [src, target !== src];
}

function mergeInstruments(
    instrument: Instrument,
    partial: PartialInstrument
): [Instrument, boolean] {
    return deepMerge(instrument, partial) as [Instrument, boolean];
}

export function mergeVariations(
    variation: Variation,
    partial: PartialVariation
): [Variation, boolean] {
    return deepMerge(variation, partial) as [Variation, boolean];
}

/*
the default instruments
*/

const RHODES_PIANO: Instrument = mergeInstruments(
    newEmptyInstrument(),
    {
        name: "RHODES PIANO",
        a: {
            enabled: true,
            frequencyOffsetHz: -1,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 3, level: 0.5 },
                { seconds: 3.5, level: 0 },
            ],

            modulationLevels: {
                b: 0.3,
            },
        },
        b: {
            enabled: true,
            frequencyOffsetHz: 1,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 2.5, level: 0.5 },
                { seconds: 3, level: 0 },
            ],

            outputLevel: 0.9,
        },
        c: {
            enabled: true,
            frequencyRatio: 8,
            frequencyOffsetHz: 800,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 0.25, level: 0 },
                { seconds: 0.25, level: 0 },
            ],

            modulationLevels: {
                b: 0.15,
                d: 0.15,
            },
        },
        d: {
            enabled: true,
            frequencyOffsetHz: 1,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 2, level: 0.5 },
                { seconds: 2.5, level: 0 },
            ],

            outputLevel: 0.6,
        },
        variations: [
            {
                input: "lfo",
                inputFrom: 0,
                inputTo: 1,

                output: "b",
                outputFrom: 1,
                outputTo: 0.7,
            },{
                input: "velocity",
                inputFrom: 30,
                inputTo: 100,

                output: "b",
                outputFrom: 0.3,
                outputTo: 1,
            },
            {
                input: "lfo",
                inputFrom: 0,
                inputTo: 1,

                output: "d",
                outputFrom: 1,
                outputTo: 0.6,
            },
            null,
            null,
        ],
        lfoWave: "sine",
        lfoDelaySeconds: 0,
        lfoAttackSeconds: 0,
        lfoFrequencyHz: 2,
    }
)[0];

const STEEL_GUITAR: Instrument = mergeInstruments(
    newEmptyInstrument(),
    {
        name: "STEEL GUITAR",
        a: {
            enabled: true,
            frequencyRatio: 3,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 0 },
                { seconds: 1.25, level: 0 },
            ],

            modulationLevels: {
                a: 0.1,
                b: 0.5,
            },
        },
        b: {
            enabled: true,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 2.5, level: 0 },
                { seconds: 2.75, level: 0 },
            ],

            outputLevel: 0.75,
        },
        c: {
            enabled: true,
            frequencyRatio: 3,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 0 },
                { seconds: 1.25, level: 0 },
            ],

            modulationLevels: {
                b: 0.2,
            },
        },
        d: {
            enabled: true,
            frequencyRatio: 8,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 0.25, level: 0 },
                { seconds: 0.25, level: 0 },
            ],

            modulationLevels: {
                b: 0.5,
                c: 0.5,
                d: 0.65,
            },
        },
        variations: [
            {
                input: "velocity",
                inputFrom: 30,
                inputTo: 80,

                output: "d",
                outputFrom: 0.5,
                outputTo: 1,
            },
            null,
            null,
            null,
            null,
        ],
    }
)[0];

const BRASS_LEAD: Instrument = mergeInstruments(
    newEmptyInstrument(),
    {
        name: "BRASS LEAD",
        a: {
            enabled: true,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 0.8 },
                { seconds: 1.125, level: 0 },
            ],

            modulationLevels: {
                a: -0.35,
                b: 0.2,
            },
        },
        b: {
            enabled: true,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 1 },
                { seconds: 1.5, level: 0 },
            ],

            modulationLevels: {
                b: 0.35,
            },

            outputLevel: 0.75,
        },
        c: {
            enabled: true,
            frequencyRatio: 4,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0.1, level: 1 },
                { seconds: 0.2, level: 0 },
                { seconds: 0.2, level: 0 },
            ],

            modulationLevels: {
                b: 0.35,
                c: 0.45,
            },
        },
        variations: [
            {
                input: "mod",
                inputFrom: 0,
                inputTo: 1,

                output: "lfo",
                outputFrom: 0,
                outputTo: 1,
            },
            {
                input: "lfo",
                inputFrom: 0,
                inputTo: 1,

                output: "a",
                outputFrom: 1,
                outputTo: 0.3,
            },
            {
                input: "lfo",
                inputFrom: 0,
                inputTo: 1,

                output: "b",
                outputFrom: 1,
                outputTo: 0.7,
            },
            null,
            null,
        ],
        lfoWave: "sine",
        lfoDelaySeconds: 0,
        lfoAttackSeconds: 0.2,
        lfoFrequencyHz: 3.5,
    }
)[0];

const PIPE_ORGAN: Instrument = mergeInstruments(
    newEmptyInstrument(),
    {
        name: "PIPE ORGAN",
        a: {
            enabled: true,
            frequencyRatio: 0.5,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 1 },
                { seconds: 1.25, level: 0 },
            ],

            modulationLevels: {
                a: 0.1,
            },

            outputLevel: 0.5,
        },
        b: {
            enabled: true,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 1 },
                { seconds: 1.5, level: 0 },
            ],

            modulationLevels: {
                b: 0.1,
            },

            outputLevel: 0.5,
        },
        c: {
            enabled: true,
            frequencyRatio: 2,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 1 },
                { seconds: 1.75, level: 0 },
            ],

            modulationLevels: {
                c: 0.1,
            },

            outputLevel: 0.3,
        },
        d: {
            enabled: true,
            frequencyRatio: 6,

            envelope: [
                { seconds: 0, level: 0 },
                { seconds: 0, level: 1 },
                { seconds: 1, level: 1 },
                { seconds: 2, level: 0 },
            ],

            modulationLevels: {
                d: 0.1,
            },

            outputLevel: 0.3,
        },
    }
)[0];

const BASIC_SINE: Instrument = mergeInstruments(
    newEmptyInstrument(),
    {
        name: "BASIC SINE",
        b: {
            enabled: true,
            gain: 1,
            outputLevel: 1,
        },
    },
)[0];

/*
the InstrumentModel
*/

export class InstrumentModel {
    /*
    the collection of instruments
    */

    private instruments: Instrument[] = [
        deepCloneInstrument(RHODES_PIANO),
        deepCloneInstrument(STEEL_GUITAR),
        deepCloneInstrument(BRASS_LEAD),
        deepCloneInstrument(PIPE_ORGAN),
        deepCloneInstrument(BASIC_SINE),
    ];

    get numInstruments() {
        return this.instruments.length;
    }

    get instrumentNames(): string[] {
        let names = [];
        for (let instrument of this.instruments) {
            names.push(instrument.name);
        }

        return names;
    }

    deleteInstrument(i: number) {
        if (i >= 0 && i < this.instruments.length) {
            for (let j = i; j < this.instruments.length - 1; j++) {
                this.instruments[j] = this.instruments[j + 1];
            }

            this.instruments.pop();

            if (
                this.activeInstrumentValue > i ||
                this.activeInstrumentValue == this.instruments.length
            ) {
                this.activeInstrument -= 1;
            }
        }
    }

    copyInstrument(i: number) {
        if (i >= 0 && i < this.instruments.length) {
            let newInstrument = deepCloneInstrument(this.instruments[i]);
            this.instruments.push(newInstrument);

            this.activeInstrument = this.instruments.length - 1;
        }
    }

    /*
    the index of the currently-selected instrument
    */

    private activeInstrumentValue: number = 0;

    get activeInstrument() {
        return this.activeInstrumentValue;
    }

    set activeInstrument(newValue: number) {
        if (newValue >= this.instruments.length) {
            throw new Error(
                `activeInstrument set to ${newValue}, but there are only ` +
                `${this.instruments.length} instruments`
            );
        }

        if (newValue !== this.activeInstrumentValue) {
            this.activeInstrumentValue = newValue;

            this.eventTarget.dispatchEvent(new Event("activeinstrumentchange"));
        }
    }

    /*
    an accessor for the properties of the currently-selected instrument. always returns
    a newly-allocated clone of the Instrument; use the mutate() method to make changes.
    */

    get instrument(): Readonly<Instrument> {
        return deepCloneInstrument(this.instruments[this.activeInstrumentValue]);
    }

    /*
    "mutateinstrument" events are fired when merge() mutates the active instrument, but not
    when the `activeInstrument` property is mutated
    */

    private eventTarget = new EventTarget();

    addEventListener(ty: InstrumentModelEventType, listener: (ev: any) => any) {
        this.eventTarget.addEventListener(ty, (ev: Event) => listener(ev));
    }

    removeEventListener(ty: InstrumentModelEventType, listener: (ev: any) => any) {
        this.eventTarget.removeEventListener(ty, (ev: Event) => listener(ev));
    }

    /*
    mutate the active Instrument by structurally merging the argument onto it. for example,
    to disable operator b, call:

        instrumentModel.merge({ b: { enabled: false }})
    
    if any fields were actually mutated, triggers a "mutateinstrument" event and then
    returns `true`
    */

    merge(partial: PartialInstrument): boolean {
        let [mergedInstrument, anyDifference] = mergeInstruments(
            this.instruments[this.activeInstrumentValue],
            partial,
        );

        this.instruments[this.activeInstrumentValue] = mergedInstrument;

        if (anyDifference) {
            this.eventTarget.dispatchEvent(new Event("mutateinstrument"));
        }

        return anyDifference;
    }
}

type InstrumentModelEventType = "mutateinstrument" | "activeinstrumentchange";
