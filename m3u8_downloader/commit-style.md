# Commit Message Style Guide

## Format

[<type>] <scope>: <subject>

<optional body>

[optional footer]

## Types
- feat: A new feature
- fix: A bug fix
- docs: Documentation changes
- style: Code style changes (formatting, missing semi-colons, etc)
- refactor: Code refactoring
- test: Adding or updating tests
- chore: Maintenance tasks

## Rules
- Subject line should be 50 chars or less
- Use imperative mood ("Add feature" not "Added feature")
- Don't end subject line with period
- Body should wrap at 72 characters
- Explain what and why vs. how
- Each modified file should have its own description.
- In traditional Chinese.
- Describing content in Taiwan Chinese usage habits.

## Examples
[feat] auth: implement JWT authentication
[fix] database: resolve connection timeout issue
[docs] api: update endpoint documentation
[test] user: add unit tests for user registration

## Project-Specific
- Include ticket number in footer: "Refs: #123"
- Mark breaking changes with "BREAKING CHANGE:" in footer
- Add co-authors if pair programming