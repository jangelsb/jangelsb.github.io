# Mortgage Analyzer Pro

A client-side mortgage scenario and property comparison tool.

## Project structure

- `index.html` — page shell and external dependencies.
- `style.css` — application styles.
- `src/app.js` — DOM rendering, event handling, and application workflow.
- `src/calculations.js` — pure mortgage calculations.
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
