# Working specifications

This directory holds the specification for work that is currently in flight. Everything here except
this README is gitignored and expected to be deleted. Nothing here is a contract, and nothing outside
this directory may depend on it.

`docs/` is the opposite: committed, durable, and written for someone who has to understand the system
without having lived through the change that produced it.

## Layout

One directory per initiative, named `YYYY-MM-<slug>`:

```
.spec/
  README.md                  tracked; this file
  2026-08-ux-redesign/       gitignored
    SPEC.md
    T3-CODE-UX-AUDIT.md
```

Put the specification, its research, audits, migration notes, and scratch analysis inside that
directory. Date-prefixing makes staleness visible at a glance, which is what makes pruning a
five-second decision instead of an archaeology exercise.

## Rules

1. A committed file must never link to a `.spec/` path. A reader who clones the repository will not
   have it, and a reader who does will find it deleted a month later.
2. If a rule in a working specification is still true after the initiative ships, it is not a working
   specification. Promote it into the matching `docs/` file, then delete the original.
3. Do not resolve a conflict between `.spec/` and `docs/` by editing `docs/` to match. The durable
   contract wins until it is deliberately changed with its own rationale.

## Pruning

Delete an initiative directory once its work is merged and verified. Review the whole directory
whenever it feels crowded—there is no schedule and no tooling, because a directory of dated folders
makes the stale ones obvious:

```sh
ls -1 .spec/            # anything more than a couple of months old is a candidate
rm -rf .spec/2026-08-ux-redesign
```

Before deleting, apply rule 2: check whether anything in the directory outlived the initiative.
