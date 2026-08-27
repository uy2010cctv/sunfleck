# @deepseek-ai/dsh-enterprise-memory-context

English | [中文](README.zh.md)

Enterprise-only prompt context for approved organization and department memories. The plugin resolves a Session cwd through enterprise workspace grants and injects only approved summaries. It never loads raw conversation bodies, proposed/rejected entries, or memory outside the workspace compartment.

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. Repository review and privacy screening remain the authority; this package does not extract or approve memory.
