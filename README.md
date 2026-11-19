# Keros3ne engine

What plays a game. A studio's game is played from its books, and this is everything that
does it: the random stream, the books and their checks, the rules every bet is held to,
and the bet pipeline that checks a bet, charges it, draws it, settles it and puts it on
record.

It is used in two places, and that is the point of it:

- **A site** plays every bet through it, over a store it makes on its own database.
- **A studio** plays a game alone on its own machine through it, over a store in memory:
  the SDK's `keros3ne-studio dev` is a small wrapper round `stand-in.ts`.

So a game behaves on a studio's machine as it will on a site. There is one set of rules.

A studio does not use this package directly. It writes a game with the SDK
(`@keros3ne/sdk`), which depends on the engine and gives a studio what it needs of it
under its own names.

## What is in it

| Entry                                       | What it is                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `/rng`                                      | The random stream every outcome is drawn with. Pinned by a test.  |
| `/book`, `/book-round`, `/book-files`       | A book's format and digests, a round drawn from one, books opened |
| `/book-check`                               | The checks a game's books are held to, its return among them      |
| `/book-game`                                | A game presented from its books as a round game                   |
| `/game-manifest`, `/guide`, `/shapes`       | A game's `game.json` and `guide.json`, and the shapes it is shown |
| `/maths`                                    | The round game contract                                           |
| `/bets`, `/stake-steps`, `/limits`, `/kero` | The rules of a bet: its limits, steps and cost, and its settling  |
| `/pipeline`                                 | The bet pipeline, and the store it asks for what is kept          |
| `/memory`, `/stand-in`                      | A store in memory, and a game played alone on it                  |
| `/play`, `/listing`                         | A site's studio games opened from their books, and their listing  |
| `/proofs`, `/verify`, `/verify-books`       | A bet checked from its seeds, in a player's own browser           |
| `/frame`, `/serve`, `/protocol`             | The policy a game's frame is held to, its files served, and the   |
|                                             | messages between a game and what shows it                         |

Every entry is the file of the same name in `src/`. It is source: TypeScript, read as it
is, with no build.

## The pipeline and its store

`createPipeline({ find, maths })` gives `placeInstant`, `openRound`, `actInRound`,
`currentRound` and `progressView`. Each takes a `BetStore` first: where the balance, the
seeds, a bet's record and a game's meters are kept. A site makes one on the transaction a
step runs in, which locks the player; `createMemoryStore()` makes one in memory. A step
that throws must leave nothing behind: a site's transaction is undone, and the store in
memory is put back with `snapshot()` and `restore()`.

A store may say what else a settled bet brings (`settled`): a site's level progress or a
dropped pack. What it returns goes back with the bet.

## Working on it

```sh
bun install
bun run test         # Vitest, on Bun
bun run typecheck
bun run format
```

It depends on nothing of Keros3ne's. The SDK, and a site, depend on it at a git tag. To
change it: change it here, run its tests, raise the version in `package.json`, commit, tag
`v<version>` and push.

## Licence

MIT. See `LICENSE`.
