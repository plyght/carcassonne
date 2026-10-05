# Engine rules notes

The decisions and interpretations the engine makes, with sources. The tests in `rules_test.zig` cite the rulebook examples they come from.

## Sources
- **WikiCarpedia, "Base game"**: 3rd-edition (C3) rules text, Examples 1a–5b, and the tile distribution. https://wikicarpedia.com/car/Base_game
- **WikiCarpedia, "River"**: setup, the U-turn rule and FAQ, and the C3 tile list. https://wikicarpedia.com/car/River
- **WikiCarpedia, "The Abbot"**: placement, recall and scoring, the FAQ notes, and the list of garden tiles. https://wikicarpedia.com/car/The_Abbot
- **WikiCarpedia, "The Farmers"**: the 3rd-edition field rules. https://wikicarpedia.com/car/The_Farmers
- **Board Game Arena forum, "Field scoring"**: summary of the 1st, 2nd and 3rd edition farmer rules. https://forum.boardgamearena.com/viewtopic.php?p=57759

All the wiki pages were fetched as raw wikitext (`?action=raw`). The tile edge layouts were read from the C3 tile images.

## Tiles
- **Base game:** 72 tiles in 24 letter types A–X, with 10 pennants. `D` is the start tile.
- **Gardens:** in the 3rd edition, exactly **one copy** each of E, H, I, M, N, R, U and V shows a garden (8 base tiles), plus River tile J (our `R10`). A garden copy plays differently from a plain copy, so each one has its own id: `Eg`, `Hg`, `Ig`, `Mg`, `Ng`, `Rg`, `Ug`, `Vg`.
  - The garden is appended as the last feature, so the other feature indices match the plain tile.
  - Each id still has a letter prefix. **This extends the contract's id list** (`"A"…"X"`). `GameView.remaining` reports the garden copies under their own ids.
  - Gardens have no ports, so where a garden sits inside its field does not affect the rules. The geo workstream picks the position.
  - When the Abbot is disabled, gardens are inert: nothing can occupy them and they never score.
- **River:** the C3 River I tiles. `R1`…`R12` map to the wiki's letters A…L. `R1` is the spring (with a road from N to E). `R12` is the lake, which has a cloister.
  - The spring and the lake each have one field wrapping around the river end. This follows the RGG Big Box wording quoted on the River page.

## Setup
- **With the River:** the spring is placed at (0,0) flowing south (rot 0). The other 10 river tiles are shuffled, with the lake under them. All 72 base tiles follow, shuffled, and the base start tile is just a normal land tile ("The river expansions replace the start tile").
- **Without the River:** one `D` is placed at (0,0) with rot 0, and the other 71 tiles are shuffled.
- **Shuffling:** one xoshiro256** stream seeded through SplitMix64 (`rng.zig`). The river tiles are shuffled first, then the base tiles.
- `handSize` must be 1. The hand variant is P1, so `Game.init` rejects any other value (`game_new` returns 0).

## Placement
- A tile must touch the board, and every edge must match: road↔road, city↔city, field↔field, river↔river.
- **Unplaceable tiles** are shown, removed from the game, and a new tile is drawn. This repeats until a tile fits. If the pile runs out, the game ends.
- **River tiles** must sit on the open end of the river, with the river continuing.
  - A bend may not turn the same way as an **immediately preceding bend** (no immediate U-turn).
  - Separately, the river may never flow in the direction **opposite to the spring's flow**. This is the rulebook's second sentence: "you must not place a river bend in the direction opposite to the flow direction of the river source".
  - Together, these allow left, straight, left, but forbid right, straight, right.
  - The cell the river flows into next must also be empty.
- **Unplaceable river tile:** it is discarded and the next river tile is drawn, following the base rule (WikiCarpedia: "River tiles which cannot be placed should be removed from the game"). If that happens to the lake, the river simply stays open. Base tiles can never touch the open end, because a river edge only matches another river edge.

## Figures
- **Meeples:** a meeple may go on a road, city, field or cloister of the tile just placed, as long as that feature's whole extent (after placement) has no figure on it.
  - A meeple may go on a feature that the same placement completes. It scores and comes straight back (base FAQ).
- **Abbot:** the abbot goes only on a cloister or garden of the tile just placed. Meeples never go on gardens or on the river.
- **Recalling the abbot:** this is the turn's figure action, taken instead of placing a figure.
  - The abbot scores 1 plus its neighbours. Points go to the `cloister` or `garden` category.
  - A recall is refused when the cloister or garden is already surrounded (Abbot FAQ 11/2020). It will score 9 in the normal scoring step anyway.
  - Recall happens before that turn's scoring.

## Scoring
- **Completed features:**
  - A road scores 1 per tile.
  - A city scores 2 per tile plus 2 per pennant.
  - A cloister or garden scores 9.
  - Tiles are counted **distinctly**, so a tile with two segments of the same feature counts once.
  - A road loop counts as complete.
- **Majority:** the player(s) with the most figures on a feature score it. A tie pays full points to everyone tied. The abbot counts as one figure on its cloister.
- **Figure return:** all figures on a scored road, city, cloister or garden return to their owners. Farmers stay until the end of the game.
- **`featureScored` events** are emitted for every completed road, city or cloister, and for gardens when the Abbot is on, even when nobody scores (`winners: []`). This lets the UI animate completions.
- **Small cities:** under `fieldEdition` 1 **and 2**, a completed 2-tile city scores 2 instead of 4. The BGA summary lists "small towns gave 2 points only" for both of those editions. The PRD only mentions the 1st edition; we follow the source.
- **End of game:**
  - An incomplete road scores 1 per tile.
  - An incomplete city scores 1 per tile plus 1 per pennant.
  - A cloister or garden scores 1 plus its neighbours.
  - Then fields are scored, then `gameEnded` is emitted.

### Field editions
| Edition | Rule implemented |
|---|---|
| 3 (default) | Each field pays 3 points per completed adjacent city to its majority farmer(s). A city can pay out through several fields. |
| 2 | Same per-field majority, but **a player can score each city at most once** (BGA: "a single city could not get one player multiple points"). If tied winners of one field earn different amounts, the engine emits one `featureScored` per distinct amount. |
| 1 | City-based: each completed city scores **4** once. It goes to the player(s) with the most farmers summed across every field touching that city. The event's `cells` are the city's cells. Farmed fields that touch no completed city get a 0-point event so their farmers are returned. |

## Events and determinism
- `Game.init` performs the first draw, but does not report setup events.
- `hash()` is FNV-1a over a field-by-field little-endian serialisation of the state. A snapshot is that same byte string, base64-encoded in JSON with the hash attached. Restoring checks the hash and validates every index.
- `Game` contains no pointers, so `var copy = game;` is a complete clone (about 6 KB).

## Known gaps
- Rotations of symmetric tiles (for example `C`, or `U` at rot 0/2) are listed as separate legal placements. The AI may want to remove the duplicates.
