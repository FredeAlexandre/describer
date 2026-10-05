import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type Speaker,
  type SpeakerEmbedding,
  type Word,
} from "../src/core/index.ts";

const speaker1: Speaker = { id: "s1", name: "Speaker 1" };
const speaker2: Speaker = { id: "s2", name: "Speaker 2" };
const alexEmbedding: SpeakerEmbedding = {
  speakerId: "s1",
  embedding: [1, 0],
};
const samEmbedding: SpeakerEmbedding = {
  speakerId: "s2",
  embedding: [0, 1],
};

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speakerId: string,
): Word {
  return { id, text, start, end, speakerId, paragraphBreakBefore: false };
}

async function withLibrary(
  run: (paths: {
    readonly libraryDir: string;
    readonly firstPath: string;
    readonly secondPath: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "describer-voices-"));
  const libraryDir = path.join(root, "library");
  const firstPath = path.join(root, "standup.mp4");
  const secondPath = path.join(root, "retro.wav");
  await writeFile(firstPath, "");
  await writeFile(secondPath, "");
  try {
    await run({ libraryDir, firstPath, secondPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("after diarization, a stored Voice may suggest a Speaker name that is not applied", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const next = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
    });
    const second = await next.importSource(secondPath, "English");
    const opened = next.openProject(second.id);
    expect(opened.transcript.speakers).toEqual([speaker1]);
    expect(opened.transcript.speakerSuggestions).toEqual([
      { speaker: speaker1, suggestedName: "Alex" },
    ]);
  });
});

test("accepting a Voice suggestion applies that name to the Speaker", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const next = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
    });
    const second = await next.importSource(secondPath, "English");
    const opened = next.openProject(second.id);
    await opened.acceptSpeakerSuggestion(speaker1);
    expect(opened.transcript.speakers).toEqual([
      { id: "s1", name: "Alex" },
    ]);
    expect(opened.transcript.speakerSuggestions).toEqual([]);
  });
});

test("replacing a Voice suggestion names the Speaker without applying the suggestion", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const next = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
    });
    const second = await next.importSource(secondPath, "English");
    const opened = next.openProject(second.id);
    await opened.renameSpeaker(speaker1, "Sam");
    expect(opened.transcript.speakers).toEqual([{ id: "s1", name: "Sam" }]);
    expect(opened.transcript.speakerSuggestions).toEqual([]);
  });
});

test("replacing a Voice suggestion is what later Projects are offered", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const later = word("w3", "Later", 0, 0.4, "s1");
    const thirdPath = path.join(path.dirname(firstPath), "planning.wav");
    await writeFile(thirdPath, "");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const afterFirst = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
    });
    const second = await afterFirst.importSource(secondPath, "English");
    await afterFirst.openProject(second.id).renameSpeaker(speaker1, "Sam");

    const afterSecond = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([later], [speaker1], [alexEmbedding]),
    });
    const third = await afterSecond.importSource(thirdPath, "English");
    const opened = afterSecond.openProject(third.id);
    expect(opened.transcript.speakers).toEqual([speaker1]);
    expect(opened.transcript.speakerSuggestions).toEqual([
      { speaker: speaker1, suggestedName: "Sam" },
    ]);
  });
});

test("a Voice is not suggested for a different-sounding Speaker", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const next = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(
        [thanks],
        [speaker1],
        [{ speakerId: "s1", embedding: samEmbedding.embedding }],
      ),
    });
    const second = await next.importSource(secondPath, "English");
    const opened = next.openProject(second.id);
    expect(opened.transcript.speakers).toEqual([speaker1]);
    expect(opened.transcript.speakerSuggestions).toEqual([]);
  });
});

test("each stored Voice may suggest a name for one Speaker on a new Project", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0.5, 0.9, "s2");
    const laterHello = word("w3", "Later", 0, 0.4, "s1");
    const laterThanks = word("w4", "again", 0.5, 0.9, "s2");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(
        [hello, thanks],
        [speaker1, speaker2],
        [alexEmbedding, samEmbedding],
      ),
    });
    const first = await describer.importSource(firstPath, "English");
    const named = describer.openProject(first.id);
    await named.renameSpeaker(speaker1, "Alex");
    await named.renameSpeaker(speaker2, "Sam");

    const next = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(
        [laterHello, laterThanks],
        [speaker1, speaker2],
        [alexEmbedding, samEmbedding],
      ),
    });
    const second = await next.importSource(secondPath, "English");
    const opened = next.openProject(second.id);
    expect(opened.transcript.speakers).toEqual([speaker1, speaker2]);
    expect(opened.transcript.speakerSuggestions).toEqual([
      { speaker: speaker1, suggestedName: "Alex" },
      { speaker: speaker2, suggestedName: "Sam" },
    ]);
  });
});

test("a Voice suggestion stays until accepted after the Project is reopened", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
    });
    const first = await describer.importSource(firstPath, "English");
    await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");

    const imported = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
    });
    const second = await imported.importSource(secondPath, "English");

    const reopened = await openDescriber({ libraryDir });
    const opened = reopened.openProject(second.id);
    expect(opened.transcript.speakers).toEqual([speaker1]);
    expect(opened.transcript.speakerSuggestions).toEqual([
      { speaker: speaker1, suggestedName: "Alex" },
    ]);
  });
});

test("Voice matching does not send media off the machine", async () => {
  await withLibrary(async ({ libraryDir, firstPath, secondPath }) => {
    const hello = word("w1", "Hello", 0, 0.4, "s1");
    const thanks = word("w2", "Thanks", 0, 0.4, "s1");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      throw new Error(`unexpected network request: ${url}`);
    };
    try {
      const describer = await openDescriber({
        libraryDir,
        processor: fixtureProcessor([hello], [speaker1], [alexEmbedding]),
      });
      const first = await describer.importSource(firstPath, "English");
      await describer.openProject(first.id).renameSpeaker(speaker1, "Alex");
      const next = await openDescriber({
        libraryDir,
        processor: fixtureProcessor([thanks], [speaker1], [alexEmbedding]),
      });
      const second = await next.importSource(secondPath, "English");
      const opened = next.openProject(second.id);
      expect(opened.transcript.speakerSuggestions).toEqual([
        { speaker: speaker1, suggestedName: "Alex" },
      ]);
      expect(opened.transcript.speakers).toEqual([speaker1]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

