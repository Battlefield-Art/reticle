/**
 * "No package.json found here" is the wrong answer to a Python project.
 *
 * It reads as a wrong-directory error, so the reader goes looking for a directory — which is what an
 * agent on a Streamlit app did, before hunting for a standalone browser bundle to inject by hand.
 * Neither search could have succeeded: the SDK has to be imported by the app's own JS build, and
 * there was no JS build.
 */

import { describe, expect, it } from 'vitest';
import { detectNonJsEcosystem, noPackageJsonMessage } from './non-js-project.js';

const withFiles =
  (...files: string[]) =>
  (file: string): boolean =>
    files.includes(file);

describe('ecosystem detection', () => {
  it('recognises the common Python markers', () => {
    for (const marker of ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py']) {
      expect(detectNonJsEcosystem(withFiles(marker)), marker).toBe('Python');
    }
  });

  it('names Django specifically, since manage.py is unambiguous', () => {
    expect(detectNonJsEcosystem(withFiles('manage.py'))).toBe('Python (Django)');
  });

  it('recognises the other ecosystems an agent is likely to meet', () => {
    expect(detectNonJsEcosystem(withFiles('Gemfile'))).toBe('Ruby');
    expect(detectNonJsEcosystem(withFiles('go.mod'))).toBe('Go');
    expect(detectNonJsEcosystem(withFiles('composer.json'))).toBe('PHP');
  });

  it('says nothing when nothing says', () => {
    expect(detectNonJsEcosystem(withFiles('README.md'))).toBeUndefined();
  });
});

describe('the message', () => {
  it('keeps the directory advice when the project could plausibly be JS', () => {
    const message = noPackageJsonMessage(withFiles('README.md'));
    expect(message).toContain("Run `reticle init` from your app's directory");
  });

  it('names the ecosystem and the real reason for a Python project', () => {
    const message = noPackageJsonMessage(withFiles('pyproject.toml'));
    expect(message).toContain('Python');
    expect(message).toContain('JavaScript build');
  });

  it('does not send a Python developer looking for a directory that cannot help', () => {
    const message = noPackageJsonMessage(withFiles('requirements.txt'));
    expect(message).toContain('there is no directory you could run this from');
  });

  it('still points at a JS front end, because plenty of Python apps have one', () => {
    const message = noPackageJsonMessage(withFiles('manage.py'));
    expect(message).toContain('--app');
    expect(message).toMatch(/frontend/);
  });
});
