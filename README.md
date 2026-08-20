# Pi packages

A private monorepo for Pi coding-agent packages.

## Layout

```text
packages/
  <package-name>/
    package.json
    src/
    README.md
```

Each publishable package will declare its own Pi resources in `package.json`,
for example:

```json
{
  "keywords": ["pi-package", "pi-extension"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

The root is private; packages are published independently when added.
