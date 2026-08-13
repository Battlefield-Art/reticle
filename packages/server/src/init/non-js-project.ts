/**
 * Telling a Python (or Ruby, or Go, or PHP) developer why Reticle cannot wire their app.
 *
 * `reticle init` answered "No package.json found here, and no app directory beneath it either",
 * which reads as *you are in the wrong directory* — so an agent on a Streamlit app went looking for
 * a directory that does not exist, then went looking for a standalone browser bundle to inject by
 * hand, and only worked out the real answer several steps later.
 *
 * The real answer is not about directories at all: Reticle's SDK has to be imported by the app's own
 * JS build, and a server-rendered Python app has no JS build to import it from. That is a property
 * of the project, it is knowable from one look at the filesystem, and saying it plainly costs the
 * reader nothing while the directory message costs them the whole investigation.
 *
 * Deliberately a hint, not a refusal: a Django or Rails app with a `frontend/` package.json is a
 * perfectly ordinary Reticle install, and this only ever speaks when there is no package.json to be
 * found anywhere.
 */

/** Marker files that identify an ecosystem, and what to call it. */
const ECOSYSTEM_MARKERS: readonly (readonly [string, string])[] = [
  ['requirements.txt', 'Python'],
  ['pyproject.toml', 'Python'],
  ['Pipfile', 'Python'],
  ['setup.py', 'Python'],
  ['manage.py', 'Python (Django)'],
  ['Gemfile', 'Ruby'],
  ['go.mod', 'Go'],
  ['composer.json', 'PHP'],
  ['Cargo.toml', 'Rust'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java'],
  ['mix.exs', 'Elixir'],
];

/** The ecosystem this directory looks like, or undefined when nothing says. */
export function detectNonJsEcosystem(exists: (file: string) => boolean): string | undefined {
  for (const [marker, name] of ECOSYSTEM_MARKERS) {
    if (exists(marker)) return name;
  }
  return undefined;
}

/**
 * What `init` should say when there is no package.json.
 *
 * Two genuinely different situations behind one old sentence: a JS developer standing in the wrong
 * directory, and a developer whose project is not JavaScript at all. The first needs a path; the
 * second needs to know that no path exists and why.
 */
export function noPackageJsonMessage(exists: (file: string) => boolean): string {
  const ecosystem = detectNonJsEcosystem(exists);
  if (ecosystem === undefined) {
    return (
      'No package.json found here, and no app directory beneath it either. Run `reticle init` from ' +
      "your app's directory, or from a repo root that contains it."
    );
  }
  return (
    `This looks like a ${ecosystem} project, and there is no package.json here or in any app ` +
    'directory beneath it. Reticle instruments a page by having its SDK imported into the app’s own ' +
    'JavaScript build — so a server-rendered app with no JS build has nowhere to load it from, and ' +
    'there is no directory you could run this from that would change that. ' +
    'If this project does have a JS front end (a `frontend/`, `client/` or `assets/` directory with ' +
    'its own package.json), run `reticle init` there, or point at it with `--app <dir>`.'
  );
}
