import { getUserConfig } from '../../config/index.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { pushRecord, setAbortController } from './shared.mjs'
import { isEmpty } from 'lodash-es'

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 */
export async function generateAnswersWithGeminiApi(port, question, session) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const config = await getUserConfig()
  const apiKey = config.geminiApiKey
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey

  const messages = getConversationPairs(
    session.conversationRecords.slice(-config.maxConversationContextLength),
    false,
  )
  messages.push({ role: 'user', content: question })

  // Gemini API expects a different message format
  const geminiPayload = {
    contents: [
      {
        parts: [
          { text: question }
        ]
      }
    ]
  }

  let answer = ''
  await fetchSSE(apiUrl, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geminiPayload),
    onMessage(message) {
      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        return
      }
      // Gemini's response parsing
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) {
        answer += text
        port.postMessage({ answer: answer, done: false, session: null })
      }
    },
    async onStart() {},
    async onEnd() {
      pushRecord(session, question, answer)
      port.postMessage({ done: true, session })
      port.onMessage.removeListener(messageListener)
      port.onDisconnect.removeListener(disconnectListener)
    },
    async onError(resp) {
      port.onMessage.removeListener(messageListener)
      port.onDisconnect.removeListener(disconnectListener)
      if (resp instanceof Error) throw resp
      const error = await resp.json().catch(() => ({}))
      throw new Error(!isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`)
    },
  })
}
