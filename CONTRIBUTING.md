# Contributing

Thanks for helping improve Side One.

## Set up the project

Use Node.js 22.13 or newer:

```bash
npm ci
npm run dev
```

No environment variables, database, Mint account, or third-party media archive
is required for the default procedural collection.

## Make a focused change

- Keep catalog and collection content in `app/record-catalog.ts` and
  `app/site-config.ts`.
- Keep renderer lifecycle, input, and disposal logic in
  `app/RecordShelfEngine.ts`.
- Add contributor-owned artwork and audio under `public/records/<record-id>/`.
- Commit only media you created or are authorized to redistribute.
- Preserve keyboard navigation, reduced-motion behavior, and the procedural
  fallback when changing visual code.
- Avoid drive-by formatting or generated-file changes unrelated to the pull
  request.

For new records, follow [docs/adding-records.md](docs/adding-records.md).

## Asset rights

Pull requests must not include scraped page captures, compiled third-party
JavaScript, proprietary 3D models, album art, audio, logos, or
descriptions unless the contributor can grant the repository the right to
redistribute them under the project’s license.

Publicly reachable files are not automatically open source. When in doubt, use
the procedural sleeve generator, the deterministic preview generator, and
content you wrote yourself.

## Run the checks

```bash
npm run check
npm run security:audit
```

If a change affects rendering, describe what you inspected manually. Do not
commit build output, Wrangler state, TypeScript build info, or private media.

## Pull requests

- Explain the user-facing outcome and any tradeoffs.
- Link related issues.
- Include tests for changed data flow or interaction logic.
- Call out new dependencies and why they are needed.
- State the source and license of every new media asset.

By contributing, you agree that your contribution may be distributed under the
project license selected by the maintainers.
