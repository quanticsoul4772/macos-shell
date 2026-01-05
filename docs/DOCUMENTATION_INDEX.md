# Documentation Index

## Overview
This directory contains comprehensive documentation for the macOS Shell MCP Server.

## Core Documentation

### [SEMANTIC_SEARCH.md](SEMANTIC_SEARCH.md) - **NEW**
Comprehensive guide to semantic search features (Phase 3):
- **Overview**: AI-powered semantic search using Voyage AI embeddings
- **Architecture**: Detailed system architecture with 5 services and 6 tools
- **Configuration**: VOYAGE_API_KEY setup and verification
- **Tools**: Complete reference for all 6 semantic search tools:
  - `semantic_command_search` - Intent-based command history search
  - `search_documentation` - Semantic documentation search (70+ commands)
  - `recommend_commands` - Smart command recommendations
  - `error_solution_lookup` - Error solution matching
  - `analyze_output` - Command output pattern extraction
  - `semantic_search_stats` - System statistics
- **Technical Details**: Embedding model, vector storage, performance metrics
- **Troubleshooting**: Common issues and solutions
- **Best Practices**: Query optimization, security, limitations
- **Examples**: Real-world usage scenarios

**Use Cases:**
- Finding past commands by intent ("deploy to production")
- Learning command syntax ("how to list files")
- Getting contextual recommendations
- Troubleshooting errors with similar solutions
- Analyzing command output for patterns

## Testing Documentation

### TEST_STATUS.md
Current test suite status and metrics:
- Pass rate: 100%
- Test count: 712+ tests
- Coverage: 60.62%

### TESTING.md
Complete testing guide:
- Test organization and structure
- Running tests (all, unit, integration, watch mode)
- Test patterns and best practices
- Mocking strategies
- Coverage analysis

### testing-improvement-plan.md
Future testing roadmap:
- Coverage improvement targets
- Integration test expansion
- Performance test suite
- E2E test framework

## Feature Documentation

### CHANGELOG.md
Version history and release notes:
- Feature additions
- Bug fixes
- Breaking changes
- Migration guides

## Quick Links

**Getting Started:**
1. [Installation & Setup](../README.md#installation)
2. [Configuration](../README.md#configuration)
3. [Available Tools](../README.md#available-tools-41-total)

**Advanced Features:**
- [Semantic Search Setup](SEMANTIC_SEARCH.md#configuration)
- [SSH Session Management](../README.md#ssh-guidelines)
- [Background Process Management](../README.md#background-process-implementation)
- [Cache Management](../README.md#caching-and-performance)

**Development:**
- [Project Structure](../README.md#project-structure)
- [Testing Guide](TESTING.md)
- [Architecture Details](../README.md#architecture-details)

## Documentation Updates

**Latest**: December 16, 2024
- Added comprehensive semantic search documentation
- Updated main README with 6 new semantic search tools
- Updated tool count: 35 → 41 tools
- Added semantic search configuration examples
- Documented troubleshooting for query/document similarity

**Previous**:
- Test coverage documentation
- SSH tool documentation
- Cache management documentation
- Background process management

## Contributing to Documentation

When adding new features:
1. Update [README.md](../README.md) with tool reference
2. Create detailed feature documentation in `docs/`
3. Add examples and use cases
4. Document configuration requirements
5. Include troubleshooting section
6. Update this index

## Documentation Standards

- Use GitHub-flavored markdown
- Include code examples with syntax highlighting
- Add configuration snippets with inline comments
- Document all parameters and return values
- Provide real-world usage examples
- Include troubleshooting for common issues
- Link to related documentation

## Support

For questions or documentation improvements:
- File an issue: https://github.com/quanticsoul4772/macos-shell/issues
- Label with `documentation` tag
- Suggest improvements or corrections
