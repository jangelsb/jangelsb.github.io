# Mortgage Analyzer Pro

A client-side mortgage scenario and property comparison tool. Each saved scenario can now combine a loan configuration with a builder-incentive allocation.

Builder incentives can be allocated across rate buydown, closing costs, price reduction, and design/lot upgrades. Rate-buydown points are calculated separately from the closing-cost estimate so the same incentive dollars are not counted twice. Closing costs can be estimated as a percentage of the final loan amount or entered as a fixed dollar estimate. Rate-buydown points use configurable lender/product assumptions, with a default four-point modeling cap so excess incentive remains available instead of forcing an unrealistic rate.

## Project structure

- `index.html` — page shell and external dependencies.
- `style.css` — application styles.
- `src/app.js` — DOM rendering, event handling, and application workflow.
- `src/calculations.js` — pure mortgage and incentive calculations.
- `src/data.js` — defaults, schema normalization, escaping, and IDs.
- `src/storage.js` — local storage and JSON import handling.
- `tests/` — unit tests for calculations and data normalization.

## Development

The ES modules should be served through a local web server or GitHub Pages. For example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

The tests use Node's built-in test runner and require Node.js 18 or newer:

```sh
npm test
```
