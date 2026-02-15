import { describe, it, expect } from 'vitest'
import { generateFallbackName, parseLastReviewNumber } from './reviewPersistenceService'

// We can't easily test saveReviewEntry or getGitShortHash without jsdom (needs window global).
// Pure function tests cover the core logic; saveReviewEntry integration is covered by task 5.4 (manual E2E).

// Task 5.1: Test generateFallbackName
describe('generateFallbackName', () => {
  it('should generate name in correct format', () => {
    const name = generateFallbackName()
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-review-\d{6}$/)
  })

  it('should generate unique names', () => {
    const name1 = generateFallbackName()
    const name2 = generateFallbackName()
    // May be equal if called in same second, but format should be correct
    expect(name1).toMatch(/^\d{4}-\d{2}-\d{2}-review-\d{6}$/)
    expect(name2).toMatch(/^\d{4}-\d{2}-\d{2}-review-\d{6}$/)
  })
})

// Task 5.2: Test parseLastReviewNumber
describe('parseLastReviewNumber', () => {
  it('should return 0 for empty content', () => {
    expect(parseLastReviewNumber('')).toBe(0)
  })

  it('should parse single review', () => {
    const content = '# Review\n\n## 第 1 次评审 (2026-02-14 10:30:15)\n- Fix issue\n'
    expect(parseLastReviewNumber(content)).toBe(1)
  })

  it('should parse multiple reviews and return last number', () => {
    const content = `# Review

## 第 1 次评审 (2026-02-14 10:30:15)
- Fix issue 1

## 第 2 次评审 (2026-02-14 11:00:00)
- Fix issue 2

## 第 3 次评审 (2026-02-14 12:00:00)
- Fix issue 3
`
    expect(parseLastReviewNumber(content)).toBe(3)
  })

  it('should handle content without review markers', () => {
    const content = '# Some other content\n\nNo reviews here'
    expect(parseLastReviewNumber(content)).toBe(0)
  })

  it('should handle malformed review markers', () => {
    const content = '## 第 次评审\n## Review 1\n'
    expect(parseLastReviewNumber(content)).toBe(0)
  })

  it('should parse large review numbers', () => {
    const content = '## 第 99 次评审 (2026-02-14 10:30:15)\n'
    expect(parseLastReviewNumber(content)).toBe(99)
  })
})
