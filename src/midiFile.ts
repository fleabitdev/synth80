/*
a very simple midi parser, which converts a midi file into a sorted list of note-on and note-off
messages. deliberately incomplete; in particular, no support for pedals, modwheels, pitchwheels,
nor extensive error-checking.
*/

export function parseMidi(label: string, bytes: ArrayBuffer): MidiFile {
    let data = new DataView(bytes);

    /*
    wrangle the header
    */

    if (data.getUint32(0) !== 0x4d546864) {
        throw new Error(`'${label}' MIDI is missing 'MTHd' magic number`);
    }

    if (data.getUint32(4) !== 0x06) {
        throw new Error(`'${label}' MIDI has incorrect header length`);
    }

    let midiFormat = data.getUint16(8);
    let midiNumTracks = data.getUint16(10);
    let midiTicksPerQuaver = data.getUint16(12);

    if (midiFormat !== 1) {
        throw new Error(`'${label}' MIDI has unsupported format value ${midiFormat}`);
    }

    if (midiTicksPerQuaver >= 0x8000) {
        throw new Error(`'${label}' MIDI requests SMPTE time, which is not supported`);
    }

    /*
    separately parse each track chunk
    */

    interface TrackMessage {
        type: "notedown" | "noteup" | "tempo",
        atTicks: number,

        note?: number,
        velocity?: number,
        newMicrosecsPerQuaver?: number,
    };

    let tracks: TrackMessage[][] = [];

    let trackStartI = 14;

    while (trackStartI < data.byteLength) {
        /*
        wrangle the track's headers
        */

        if (data.getUint32(trackStartI) !== 0x4d54726b) {
            throw new Error(`'${label}' MIDI is missing 'MTrk' magic number`);
        }

        let trackPayloadLength = data.getUint32(trackStartI + 4);
        let trackEndI = trackStartI + 8 + trackPayloadLength;

        if (trackEndI > data.byteLength) {
            throw new Error(`'${label}' MIDI has an invalid track length`);
        }

        /*
        consume all of the track's midi messages
        */

        let i = trackStartI + 8;
        let runningStatus = null;
        let elapsedTicks = 0;
        let trackMessages: TrackMessage[] = [];

        while (i < trackEndI) {
            function getUintVariable(): number {
                let result = 0;
                let startI = i;

                while (true) {
                    if (i >= startI + 4) {
                        throw new Error(
                            `'${label}' MIDI has an invalid variable-length uint at ${startI}`
                        );
                    }

                    let byte = data.getUint8(i);
                    i += 1;

                    result = (result << 7) | (byte & 0x7f);

                    if ((byte & 0x80) !== 0x80) {
                        break;
                    }
                }

                return result;
            }

            //read the message's "delta time", which is measured in ticks
            let deltaTicks = getUintVariable();
            elapsedTicks += deltaTicks;

            //read the message-status byte. this might be absent (highest bit unset), in which
            //case it's implied that the previous status byte repeats ("running status")
            let status = data.getUint8(i);

            if ((status & 0x80) !== 0x80) {
                if (runningStatus === null) {
                    throw new Error(
                        `'${label}' MIDI has an invalid MIDI status byte ` +
                        `0x${status.toString(16)} at ${i}`
                    );
                }

                status = runningStatus;
            } else {
                runningStatus = status;
                i += 1;
            }

            //different messages require different handling...
            if ((status & 0x70) < 0x70) {
                //this is a conventional midi message with a one- or two-byte payload
                let payload0 = data.getUint8(i);
                i += 1;

                let payload1 = 0;
                if (((status & 0x70) != 0x40) && ((status & 0x70) != 0x50)) {
                    payload1 = data.getUint8(i);
                    i += 1;
                }

                if ((status & 0x70) === 0x10 && payload1 > 0) {
                    trackMessages.push({
                        type: "notedown",
                        atTicks: elapsedTicks,

                        note: payload0,
                        velocity: payload1,
                    });
                } else if (
                    (status & 0x70) === 0x00 ||
                    ((status & 0x70) === 0x10 && payload1 === 0)
                ) {
                    trackMessages.push({
                        type: "noteup",
                        atTicks: elapsedTicks,

                        note: payload0,
                    });
                }
            } else if (status !== 0xff) {
                //this is a system message (>= 0xf0, < 0xff). we don't support them at all
                throw new Error(
                    `'${label}' MIDI has a MIDI system message ` +
                    `0x${status.toString(16)} at ${i - 1}`
                );
            } else {
                //this is a meta message with a variable-length payload
                let metaStartI = i;

                let subStatus = data.getUint8(i);
                i += 1;

                let metaPayloadLength = getUintVariable();

                if (subStatus === 0x51) {
                    if (metaPayloadLength !== 3) {
                        throw new Error(
                            `'${label}' MIDI has a malformed tempo message at ${metaStartI}`
                        );
                    }

                    let tempo0 = data.getUint8(i);
                    let tempo1 = data.getUint8(i + 1);
                    let tempo2 = data.getUint8(i + 2);
                    i += 3;

                    let tempo = (tempo0 << 16) | (tempo1 << 8) | tempo2;

                    trackMessages.push({
                        type: "tempo",
                        atTicks: elapsedTicks,

                        newMicrosecsPerQuaver: tempo,
                    });
                } else {
                    i += metaPayloadLength;
                }
            }

            //sanity check
            if (i > trackEndI) {
                throw new Error(
                    `'${label}' MIDI has an incorrect track length for track ${tracks.length}`
                )
            }
        }

        /*
        track finished! store the results, then iterate to the next track
        */

        tracks.push(trackMessages);

        trackStartI = trackEndI;
    }

    /*
    each track's results are already individually sorted. merge them together into one common
    sorted list of messages.

    when the number of elapsed ticks is equal, we can resolve the messages into an arbitrary
    order, except that "noteup" must come before "notedown".
    */

    let mergedMessages: TrackMessage[] = [];

    for (let track of tracks) {
        track.reverse();
    }

    while (true) {
        let bestTrack: TrackMessage[] | null = null;
        let bestTrackTicks: number | null = null;

        for (let track of tracks) {
            if (track.length > 0) {
                let trackTicks = track[track.length - 1].atTicks;
                let messageType = track[track.length - 1].type;
                if (
                    bestTrackTicks === null ||
                    trackTicks < bestTrackTicks ||
                    (trackTicks === bestTrackTicks && messageType === "noteup")
                ) {
                    bestTrack = track;
                    bestTrackTicks = trackTicks;
                }
            }
        }

        if (bestTrack === null) {
            break;
        } else {
            mergedMessages.push(bestTrack.pop()!);
        }
    }

    /*
    convert the merged TrackMessages list into MidiMessages by keeping track of any tempo
    changes, then using them to convert ticks into seconds

    the default tempo is 120bpm, which is 0.5 seconds per quaver
    */

    let messages: MidiMessage[] = [];

    let curMicrosecondsPerTick = 500_000 / midiTicksPerQuaver;
    let elapsedTicks = 0;
    let elapsedMicroseconds = 0;

    for (let message of mergedMessages) {
        console.assert(message.atTicks >= elapsedTicks);

        let tickDifference = message.atTicks - elapsedTicks;
        elapsedTicks += tickDifference;
        elapsedMicroseconds += tickDifference * curMicrosecondsPerTick;

        switch (message.type) {
            case "notedown":
                messages.push({
                    type: "notedown",
                    atSeconds: elapsedMicroseconds / 1_000_000,
                    note: message.note!,
                    velocity: message.velocity!,
                });
                break;

            case "noteup":
                messages.push({
                    type: "noteup",
                    atSeconds: elapsedMicroseconds / 1_000_000,
                    note: message.note!,
                });
                break;

            case "tempo":
                curMicrosecondsPerTick = message.newMicrosecsPerQuaver! / midiTicksPerQuaver;
                break;
        }
    }

    //our test midi files don't emit note-off or track-end messages with sensible timing, so we
    //synthesise an "end" event one quaver after the last real message
    let lastSeconds = messages.length === 0 ? 0 : messages[messages.length - 1].atSeconds;

    messages.push({
        type: "end",
        atSeconds: lastSeconds + (curMicrosecondsPerTick * midiTicksPerQuaver) / 1_000_000,
    });

    return {
        label,
        messages,
    };
}

export type MidiMessage = {
    type: "notedown",
    atSeconds: number,
    note: number,
    velocity: number,
} | {
    type: "noteup",
    atSeconds: number,
    note: number,
} | {
    type: "end",
    atSeconds: number,
};

export interface MidiFile {
    label: string,
    messages: MidiMessage[],
}
