import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  text: string
  className?: string
}

export function MarkdownRenderer({ text, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`${className} markdown-body`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
