<div align="center">
  <table>
    <tr>
      <td align="center">
        <a href="https://github.com/flashtrace">
          <img src="https://github.com/flashtrace.png" alt="flashtrace logo" width="140">
        </a>
      </td>
      <td align="left">
        <h3>flashtrace</h3>
        <p>
          Lightning-fast, reference-based requirement tracing that works anywhere.
        </p>
        <p>
          <a href="https://github.com/flashtrace/flashtrace/blob/main/docs/index.md">
            <img src="https://img.shields.io/badge/Spec-Driven-8e4d13.svg?labelColor=1e1e1e" alt="Spec-driven documentation." />
          </a>
          <a href="https://github.com/flashtrace/flashtrace/blob/main/CLAUDE.md">
            <img src="https://img.shields.io/badge/Agent-Native-d97d0e.svg?labelColor=1e1e1e" alt="This repository was created agent-native." />
          </a>
          <a href="https://github.com/flashtrace/flashtrace/blob/main/LICENSE">
            <img src="https://img.shields.io/badge/License-Apache_2.0-f9c21d.svg?labelColor=1e1e1e" alt="Released under the Apache 2.0 license." />
          </a>
        </p>
      </td>
    </tr>
  </table>
</div>

---

<h4 align="center">Quality Summary</h4>

<p align="center">
    <a href="https://sonarcloud.io/project/overview?id=flashtrace_flashtrace">
        <img src="https://github.com/flashtrace/flashtrace/actions/workflows/ci.yml/badge.svg" alt="Continuous Integration status." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=reliability_rating&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=reliability_rating" alt="SonarCloud reliability rating." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=security_rating&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=security_rating" alt="SonarCloud security rating." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=sqale_rating&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=sqale_rating" alt="SonarCloud maintainability rating." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=ncloc&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=ncloc" alt="Number of lines of code." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=code_smells&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=code_smells" alt="SonarCloud amount of code smells." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=duplicated_lines&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=duplicated_lines_density" alt="SonarCloud percent of duplicated lines." />
    </a>
    <a href="https://sonarcloud.io/component_measures?metric=vulnerabilities&id=flashtrace_flashtrace">
        <img src="https://sonarcloud.io/api/project_badges/measure?project=flashtrace_flashtrace&metric=vulnerabilities" alt="SonarCloud amount of vulnerabilities." />
    </a>
    <!--
        The coverage and tests badges read from the orphan `badges` branch,
        which CI rewrites on every push to main. They therefore always show
        main's last published numbers - never the numbers of the branch this
        README is viewed on.
    -->
    <a href="https://github.com/flashtrace/flashtrace/actions/workflows/ci.yml">
        <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fflashtrace%2Fflashtrace%2Fbadges%2Fcoverage.json" alt="Line coverage of src/, measured by node --test." />
    </a>
    <a href="https://github.com/flashtrace/flashtrace/actions/workflows/ci.yml">
        <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fflashtrace%2Fflashtrace%2Fbadges%2Ftests.json" alt="Number of tests run by node --test." />
    </a>
</p>

## Getting Started

To use flashtrace in your project,

- either download `dist/flashtrace.mjs` into your own repository and run `node flashtrace.mjs`
- or run `npm install flashtrace -D` to add it as a proper dev dependency to your project.

You can then execute `npx flashtrace` to run the tracing.
Read our [Usage Guide](docs/USAGE.md) for more details.
Node >= 18 is required for flashtrace to work.

Looking for a working setup to start from? The [examples/](examples/) folder
holds four self-contained example projects, from a minimal clean trace to a
deliberately broken one showing every defect flashtrace reports. Each has a
README, and the end-to-end tests verify their exact report output on every run.

## About flashtrace

Let's be honest: This project started when I needed it myself.
So on the good side, this thing works.
On the bad side, it might not yet fit your case perfectly.
But we are open to adapt and we are actively working on widening our coverage area.
Tell us about your use case - we are happy to have a look and will try to make flashtrace available to anyone!

## Community

We are available for any questions, ideas and problems.
Just search or start a thread in our [GitHub Discussions](https://github.com/flashtrace/flashtrace/discussions).

If you want to contribute to this repository, read our [Contributing Guidelines](CONTRIBUTING.md).

## License

Licensed under the [Apache 2.0 License](LICENSE).