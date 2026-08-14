# Studio Change Adapter

Provider-neutral, fail-closed boundary for untrusted model-proposed Scene patches.

- A provider may return only a versioned rationale and bounded `ScenePatch[]`.
- The adapter re-applies every patch to the supplied base Scene IR and creates the diff.
- It never saves a revision, accepts a candidate, publishes, or calls a real provider by itself.
- Whole-document output, cross-target edits, unsafe assets, extra fields and invalid Scene IR are rejected.
