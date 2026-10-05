# Describer

A personal desktop tool that turns a local meeting recording into an editable timed transcript, so the owner can later find what was actually said.

## Language

### Source and Transcript

**Source**:
An immutable media file imported from disk. It may be video or audio-only. The path is stored, not a copy of the file; the path may be pointed at another file later without changing the Transcript.
_Avoid_: Video, asset, clip, media, recording file

**Transcript**:
The timed text of speech taken from a Source. The user may correct it; correcting it does not change the Source. A Transcript has exactly one language, French or English, chosen at import. It may contain no Words.
_Avoid_: Description, captions, subtitles, transcription (the artifact is a Transcript)

**Word**:
A spoken token in the Transcript with a start time and an end time.
_Avoid_: Cue, token, caption, subtitle

**Utterance**:
A contiguous displayed span of Words spoken by one Speaker. A new Utterance starts on Speaker change, a long pause, or a paragraph break the user inserts.
_Avoid_: Paragraph, cue, caption, line, block

**Speaker**:
A name, local to a Project, for who is speaking. Diarization creates `Speaker 1`, `Speaker 2`, and so on; the user may rename, merge, or reassign Words to a Speaker. A Speaker is not an identity across Projects.
_Avoid_: Attendee, participant, person, voice

**Selection**:
A contiguous span of Words the user has highlighted.
_Avoid_: Range, clip, highlight

**Citation**:
A pasteable excerpt of a Selection: the quoted text, Speaker, timestamp, Project title, and recorded-at.
_Avoid_: Quote, snippet, evidence, copy

**Voice**:
A locally stored profile of how someone sounds. It is used only to suggest a Speaker name on a new Project; the user must accept or replace the suggestion. A Voice is not a Speaker.
_Avoid_: Person, speaker profile, embedding

### Persistence

**Project**:
The live file in the Library. It contains exactly one Source path, exactly one Transcript, a title, and a recorded-at time. Title defaults to the Source filename; recorded-at defaults to the Source file time; both are user-editable. Edits are written as they happen. Re-processing replaces the Transcript. There is no account and no sync.
_Avoid_: Document, workspace, session

**Library**:
The app-owned local working set of Projects. Import copies into it (from a Source, or from a Project file elsewhere). Export Project writes a copy out. Deleting a Project removes it from the Library and never deletes the Source.
_Avoid_: Catalog, vault, workspace, collection, database, folder

**Export**:
A derived file generated from a Project. Markdown and PDF are the readable Transcript (title, recorded-at, language, Speakers, timestamps, Utterances). SRT and VTT are captions without Speaker names. Editing an Export does not change the Transcript.
_Avoid_: Download, report, caption file
