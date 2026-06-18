# Contributing to CryptSend

Thank you for considering contributing to CryptSend! We welcome contributions from everyone.

## How to Contribute

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Run the tests** (if applicable)
5. **Commit your changes** (`git commit -m 'Add amazing feature'`)
6. **Push to your branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

## Development Guidelines

- **Code style** — follow the existing code style (no semicolons, 2-space indentation, single quotes)
- **No external dependencies** — keep the client-side code dependency-free
- **Browser compatibility** — target modern browsers (Chrome, Firefox, Safari, Edge)
- **Accessibility** — ensure all interactive elements are keyboard-accessible and have ARIA labels
- **Security** — never introduce code that compromises the zero-knowledge model
- **No secret persistence** — never use localStorage, sessionStorage, or cookies for secrets or keys
- **Comments** — write clear comments for complex logic, especially cryptographic operations

## Pull Request Process

1. Ensure your code builds and runs without errors
2. Update the README.md if needed
3. Your pull request will be reviewed by a maintainer
4. Once approved, it will be merged

## Reporting Issues

Report bugs and feature requests via [GitHub Issues](https://github.com/PatrykPanasiuk/cryptsend/issues).

## Security

For security vulnerabilities, see [SECURITY.md](SECURITY.md) — do not file a public issue.
