#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express, { type Request, type Response } from "express"
import { gmail_v1, google } from 'googleapis'
import { z } from "zod"
import { PORT } from "./config.js"
import { GmailTool, TOOLS } from "./tools.js"

type Draft = gmail_v1.Schema$Draft
type DraftCreateParams = gmail_v1.Params$Resource$Users$Drafts$Create
type DraftUpdateParams = gmail_v1.Params$Resource$Users$Drafts$Update
type Message = gmail_v1.Schema$Message
type MessagePart = gmail_v1.Schema$MessagePart
type MessagePartBody = gmail_v1.Schema$MessagePartBody
type MessagePartHeader = gmail_v1.Schema$MessagePartHeader
type MessageSendParams = gmail_v1.Params$Resource$Users$Messages$Send
type Thread = gmail_v1.Schema$Thread

type NewMessage = {
  threadId?: string
  raw?: string
  to?: string[] | undefined
  cc?: string[] | undefined
  bcc?: string[] | undefined
  subject?: string | undefined
  body?: string | undefined
  includeBodyHtml?: boolean
}

const RESPONSE_HEADERS_LIST = [
  'Date',
  'From',
  'To',
  'Subject',
  'Message-ID',
  'In-Reply-To',
  'References'
]

const formatResponse = (response: any) => ({ content: [{ type: "text", text: JSON.stringify(response) }] })

const handleTool = async (gmail: gmail_v1.Gmail, apiCall: (gmail: gmail_v1.Gmail) => Promise<any>) => {
  try {
    return await apiCall(gmail)
  } catch (error: any) {
    if (error.code === 401 || error.code === 403) {
      return formatResponse({ error: `Authentication failed: ${error.message}` })
    }
    return formatResponse({ error: `Tool execution failed: ${error.message}` })
  }
}

const decodedBody = (body: MessagePartBody) => {
  if (!body?.data) return body

  const decodedData = Buffer.from(body.data, 'base64').toString('utf-8')
  const decodedBody: MessagePartBody = {
    data: decodedData,
    size: body.data.length,
    attachmentId: body.attachmentId
  }
  return decodedBody
}

const processMessagePart = (messagePart: MessagePart, includeBodyHtml = false): MessagePart => {
  if ((messagePart.mimeType !== 'text/html' || includeBodyHtml) && messagePart.body) {
    messagePart.body = decodedBody(messagePart.body)
  }

  if (messagePart.parts) {
    messagePart.parts = messagePart.parts.map(part => processMessagePart(part, includeBodyHtml))
  }

  if (messagePart.headers) {
    messagePart.headers = messagePart.headers.filter(header => RESPONSE_HEADERS_LIST.includes(header.name || ''))
  }

  return messagePart
}

const getNestedHistory = (messagePart: MessagePart, level = 1): string => {
  if (messagePart.mimeType === 'text/plain' && messagePart.body?.data) {
    const { data } = decodedBody(messagePart.body)
    if (!data) return ''
    return data.split('\n').map(line => '>' + (line.startsWith('>') ? '' : ' ') + line).join('\n')
  }

  return (messagePart.parts || []).map(p => getNestedHistory(p, level + 1)).filter(p => p).join('\n')
}

const findHeader = (headers: MessagePartHeader[] | undefined, name: string) => {
  if (!headers || !Array.isArray(headers) || !name) return undefined
  return headers.find(h => h?.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined
}

const formatEmailList = (emailList: string | null | undefined) => {
  if (!emailList) return []
  return emailList.split(',').map(email => email.trim())
}

const getQuotedContent = (thread: Thread) => {
  if (!thread.messages?.length) return ''

  const sentMessages = thread.messages.filter(msg =>
    msg.labelIds?.includes('SENT') ||
    (!msg.labelIds?.includes('DRAFT') && findHeader(msg.payload?.headers || [], 'date'))
  )

  if (!sentMessages.length) return ''

  const lastMessage = sentMessages[sentMessages.length - 1]
  if (!lastMessage?.payload) return ''

  let quotedContent = []

  if (lastMessage.payload.headers) {
    const fromHeader = findHeader(lastMessage.payload.headers || [], 'from')
    const dateHeader = findHeader(lastMessage.payload.headers || [], 'date')
    if (fromHeader && dateHeader) {
      quotedContent.push('')
      quotedContent.push(`On ${dateHeader} ${fromHeader} wrote:`)
      quotedContent.push('')
    }
  }

  const nestedHistory = getNestedHistory(lastMessage.payload)
  if (nestedHistory) {
    quotedContent.push(nestedHistory)
    quotedContent.push('')
  }

  return quotedContent.join('\n')
}

const getThreadHeaders = (thread: Thread) => {
  let headers: string[] = []

  if (!thread.messages?.length) return headers

  const lastMessage = thread.messages[thread.messages.length - 1]
  const references: string[] = []

  let subjectHeader = findHeader(lastMessage.payload?.headers || [], 'subject')
  if (subjectHeader) {
    if (!subjectHeader.toLowerCase().startsWith('re:')) {
      subjectHeader = `Re: ${subjectHeader}`
    }
    headers.push(`Subject: ${subjectHeader}`)
  }

  const messageIdHeader = findHeader(lastMessage.payload?.headers || [], 'message-id')
  if (messageIdHeader) {
    headers.push(`In-Reply-To: ${messageIdHeader}`)
    references.push(messageIdHeader)
  }

  const referencesHeader = findHeader(lastMessage.payload?.headers || [], 'references')
  if (referencesHeader) references.unshift(...referencesHeader.split(' '))

  if (references.length > 0) headers.push(`References: ${references.join(' ')}`)

  return headers
}

const wrapTextBody = (text: string): string => text.split('\n').map(line => {
  if (line.length <= 76) return line
  const chunks = line.match(/.{1,76}/g) || []
  return chunks.join('=\n')
}).join('\n')

const constructRawMessage = async (gmail: gmail_v1.Gmail, params: NewMessage) => {
  let thread: Thread | null = null
  if (params.threadId) {
    const threadParams = { userId: 'me', id: params.threadId, format: 'full' }
    const { data } = await gmail.users.threads.get(threadParams)
    thread = data
  }

  const message = []
  if (params.to?.length) message.push(`To: ${wrapTextBody(params.to.join(', '))}`)
  if (params.cc?.length) message.push(`Cc: ${wrapTextBody(params.cc.join(', '))}`)
  if (params.bcc?.length) message.push(`Bcc: ${wrapTextBody(params.bcc.join(', '))}`)
  if (thread) {
    message.push(...getThreadHeaders(thread).map(header => wrapTextBody(header)))
  } else if (params.subject) {
    message.push(`Subject: ${wrapTextBody(params.subject)}`)
  } else {
    message.push('Subject: (No Subject)')
  }
  message.push('Content-Type: text/plain; charset="UTF-8"')
  message.push('Content-Transfer-Encoding: quoted-printable')
  message.push('MIME-Version: 1.0')
  message.push('')

  if (params.body) message.push(wrapTextBody(params.body))

  if (thread) {
    const quotedContent = getQuotedContent(thread)
    if (quotedContent) {
      message.push('')
      message.push(wrapTextBody(quotedContent))
    }
  }

  return Buffer.from(message.join('\r\n')).toString('base64url').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createServer({ gmail }: { gmail: gmail_v1.Gmail }) {
  const serverInfo = {
    name: "Gmail-MCP",
    version: "1.7.4",
    description: "Gmail MCP - Stateless HTTP server providing Gmail API access via bearer-token authentication"
  }

  const server = new McpServer(serverInfo)

  server.tool(TOOLS[GmailTool.CreateDraft].name,
    TOOLS[GmailTool.CreateDraft].description,
    {
      raw: z.string().optional().describe("The entire email message in base64url encoded RFC 2822 format, ignores params.to, cc, bcc, subject, body, includeBodyHtml if provided"),
      threadId: z.string().optional().describe("The thread ID to associate this draft with"),
      to: z.array(z.string()).optional().describe("List of recipient email addresses"),
      cc: z.array(z.string()).optional().describe("List of CC recipient email addresses"),
      bcc: z.array(z.string()).optional().describe("List of BCC recipient email addresses"),
      subject: z.string().optional().describe("The subject of the email"),
      body: z.string().optional().describe("The body of the email"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        let raw = params.raw
        if (!raw) raw = await constructRawMessage(gmail, params)

        const draftCreateParams: DraftCreateParams = { userId: 'me', requestBody: { message: { raw } } }
        if (params.threadId && draftCreateParams.requestBody?.message) {
          draftCreateParams.requestBody.message.threadId = params.threadId
        }

        const { data } = await gmail.users.drafts.create(draftCreateParams)

        if (data.message?.payload) {
          data.message.payload = processMessagePart(
            data.message.payload,
            params.includeBodyHtml
          )
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteDraft].name,
    TOOLS[GmailTool.DeleteDraft].description,
    {
      id: z.string().describe("The ID of the draft to delete")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.drafts.delete({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetDraft].name,
    TOOLS[GmailTool.GetDraft].description,
    {
      id: z.string().describe("The ID of the draft to retrieve"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.drafts.get({ userId: 'me', id: params.id, format: 'full' })

        if (data.message?.payload) {
          data.message.payload = processMessagePart(
            data.message.payload,
            params.includeBodyHtml
          )
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListDrafts].name,
    TOOLS[GmailTool.ListDrafts].description,
    {
      maxResults: z.number().optional().describe("Maximum number of drafts to return. Accepts values between 1-500"),
      q: z.string().optional().describe("Only return drafts matching the specified query. Supports the same query format as the Gmail search box"),
      includeSpamTrash: z.boolean().optional().describe("Include drafts from SPAM and TRASH in the results"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large"),
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        let drafts: Draft[] = []

        const { data } = await gmail.users.drafts.list({ userId: 'me', ...params })

        drafts.push(...data.drafts || [])

        while (data.nextPageToken) {
          const { data: nextData } = await gmail.users.drafts.list({ userId: 'me', ...params, pageToken: data.nextPageToken })
          drafts.push(...nextData.drafts || [])
        }

        if (drafts) {
          drafts = drafts.map(draft => {
            if (draft.message?.payload) {
              draft.message.payload = processMessagePart(
                draft.message.payload,
                params.includeBodyHtml
              )
            }
            return draft
          })
        }

        return formatResponse(drafts)
      })
    }
  )

  server.tool(TOOLS[GmailTool.SendDraft].name,
    TOOLS[GmailTool.SendDraft].description,
    {
      id: z.string().describe("The ID of the draft to send")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        try {
          const { data } = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: params.id } })
          return formatResponse(data)
        } catch (error) {
          return formatResponse({ error: 'Error sending draft, are you sure you have at least one recipient?' })
        }
      })
    }
  )

  // TODO debug issue with subject not being applied correctly
  // server.tool("update_draft",
  //   "Replace a draft's content. Note the mechanics of the threadId and raw parameters.",
  //   {
  //     id: z.string().describe("The ID of the draft to update"),
  //     threadId: z.string().optional().describe("The thread ID to associate this draft with, will be copied from the current draft if not provided"),
  //     raw: z.string().optional().describe("The entire email message in base64url encoded RFC 2822 format, ignores params.to, cc, bcc, subject, body, includeBodyHtml if provided"),
  //     to: z.array(z.string()).optional().describe("List of recipient email addresses, will be copied from the current draft if not provided"),
  //     cc: z.array(z.string()).optional().describe("List of CC recipient email addresses, will be copied from the current draft if not provided"),
  //     bcc: z.array(z.string()).optional().describe("List of BCC recipient email addresses, will be copied from the current draft if not provided"),
  //     subject: z.string().optional().describe("The subject of the email, will be copied from the current draft if not provided"),
  //     body: z.string().optional().describe("The body of the email, will be copied from the current draft if not provided"),
  //     includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
  //   },
  //   async (params) => {
  //     return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
  //       let raw = params.raw
  //       const currentDraft = await gmail.users.drafts.get({ userId: 'me', id: params.id, format: 'full' })
  //       const { payload } = currentDraft.data.message ?? {}

  //       if (currentDraft.data.message?.threadId && !params.threadId) params.threadId = currentDraft.data.message.threadId
  //       if (!params.to) params.to = formatEmailList(findHeader(payload?.headers || [], 'to'))
  //       if (!params.cc) params.cc = formatEmailList(findHeader(payload?.headers || [], 'cc'))
  //       if (!params.bcc) params.bcc = formatEmailList(findHeader(payload?.headers || [], 'bcc'))
  //       if (!params.subject) params.subject = findHeader(payload?.headers || [], 'subject')
  //       if (!params.body) params.body = payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data ?? undefined

  //       if (!raw) raw = await constructRawMessage(gmail, params)

  //       const draftUpdateParams: DraftUpdateParams = { userId: 'me', id: params.id, requestBody: { message: { raw, id: params.id } } }
  //       if (params.threadId && draftUpdateParams.requestBody?.message) {
  //         draftUpdateParams.requestBody.message.threadId = params.threadId
  //       }

  //       const { data } = await gmail.users.drafts.update(draftUpdateParams)

  //       if (data.message?.payload) {
  //         data.message.payload = processMessagePart(
  //           data.message.payload,
  //           params.includeBodyHtml
  //         )
  //       }

  //       return formatResponse(data)
  //     })
  //   }
  // )

  server.tool(TOOLS[GmailTool.CreateLabel].name,
    TOOLS[GmailTool.CreateLabel].description,
    {
      name: z.string().describe("The display name of the label"),
      messageListVisibility: z.enum(['show', 'hide']).optional().describe("The visibility of messages with this label in the message list"),
      labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("The visibility of the label in the label list"),
      color: z.object({
        textColor: z.string().describe("The text color of the label as hex string"),
        backgroundColor: z.string().describe("The background color of the label as hex string")
      }).optional().describe("The color settings for the label")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.create({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteLabel].name,
    TOOLS[GmailTool.DeleteLabel].description,
    {
      id: z.string().describe("The ID of the label to delete")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.delete({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetLabel].name,
    TOOLS[GmailTool.GetLabel].description,
    {
      id: z.string().describe("The ID of the label to retrieve")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.get({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListLabels].name,
    TOOLS[GmailTool.ListLabels].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.list({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.PatchLabel].name,
    TOOLS[GmailTool.PatchLabel].description,
    {
      id: z.string().describe("The ID of the label to patch"),
      name: z.string().optional().describe("The display name of the label"),
      messageListVisibility: z.enum(['show', 'hide']).optional().describe("The visibility of messages with this label in the message list"),
      labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("The visibility of the label in the label list"),
      color: z.object({
        textColor: z.string().describe("The text color of the label as hex string"),
        backgroundColor: z.string().describe("The background color of the label as hex string")
      }).optional().describe("The color settings for the label")
    },
    async (params) => {
      const { id, ...labelData } = params
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.patch({ userId: 'me', id, requestBody: labelData })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateLabel].name,
    TOOLS[GmailTool.UpdateLabel].description,
    {
      id: z.string().describe("The ID of the label to update"),
      name: z.string().optional().describe("The display name of the label"),
      messageListVisibility: z.enum(['show', 'hide']).optional().describe("The visibility of messages with this label in the message list"),
      labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("The visibility of the label in the label list"),
      color: z.object({
        textColor: z.string().describe("The text color of the label as hex string"),
        backgroundColor: z.string().describe("The background color of the label as hex string")
      }).optional().describe("The color settings for the label")
    },
    async (params) => {
      const { id, ...labelData } = params
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.labels.update({ userId: 'me', id, requestBody: labelData })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.BatchDeleteMessages].name,
    TOOLS[GmailTool.BatchDeleteMessages].description,
    {
      ids: z.array(z.string()).describe("The IDs of the messages to delete")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.batchDelete({ userId: 'me', requestBody: { ids: params.ids } })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.BatchModifyMessages].name,
    TOOLS[GmailTool.BatchModifyMessages].description,
    {
      ids: z.array(z.string()).describe("The IDs of the messages to modify"),
      addLabelIds: z.array(z.string()).optional().describe("A list of label IDs to add to the messages"),
      removeLabelIds: z.array(z.string()).optional().describe("A list of label IDs to remove from the messages")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.batchModify({ userId: 'me', requestBody: { ids: params.ids, addLabelIds: params.addLabelIds, removeLabelIds: params.removeLabelIds } })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteMessage].name,
    TOOLS[GmailTool.DeleteMessage].description,
    {
      id: z.string().describe("The ID of the message to delete")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.delete({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetMessage].name,
    TOOLS[GmailTool.GetMessage].description,
    {
      id: z.string().describe("The ID of the message to retrieve"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.get({ userId: 'me', id: params.id, format: 'full' })

        if (data.payload) {
          data.payload = processMessagePart(data.payload, params.includeBodyHtml)
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListMessages].name,
    TOOLS[GmailTool.ListMessages].description,
    {
      maxResults: z.number().optional().describe("Maximum number of messages to return. Accepts values between 1-500"),
      pageToken: z.string().optional().describe("Page token to retrieve a specific page of results"),
      q: z.string().optional().describe("Only return messages matching the specified query. Supports the same query format as the Gmail search box"),
      labelIds: z.array(z.string()).optional().describe("Only return messages with labels that match all of the specified label IDs"),
      includeSpamTrash: z.boolean().optional().describe("Include messages from SPAM and TRASH in the results"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large"),
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.list({ userId: 'me', ...params })

        if (data.messages) {
          data.messages = data.messages.map((message: Message) => {
            if (message.payload) {
              message.payload = processMessagePart(
                message.payload,
                params.includeBodyHtml
              )
            }
            return message
          })
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ModifyMessage].name,
    TOOLS[GmailTool.ModifyMessage].description,
    {
      id: z.string().describe("The ID of the message to modify"),
      addLabelIds: z.array(z.string()).optional().describe("A list of label IDs to add to the message"),
      removeLabelIds: z.array(z.string()).optional().describe("A list of label IDs to remove from the message")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.modify({ userId: 'me', id: params.id, requestBody: { addLabelIds: params.addLabelIds, removeLabelIds: params.removeLabelIds } })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.SendMessage].name,
    TOOLS[GmailTool.SendMessage].description,
    {
      raw: z.string().optional().describe("The entire email message in base64url encoded RFC 2822 format, ignores params.to, cc, bcc, subject, body, includeBodyHtml if provided"),
      threadId: z.string().optional().describe("The thread ID to associate this message with"),
      to: z.array(z.string()).optional().describe("List of recipient email addresses"),
      cc: z.array(z.string()).optional().describe("List of CC recipient email addresses"),
      bcc: z.array(z.string()).optional().describe("List of BCC recipient email addresses"),
      subject: z.string().optional().describe("The subject of the email"),
      body: z.string().optional().describe("The body of the email"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        let raw = params.raw
        if (!raw) raw = await constructRawMessage(gmail, params)

        const messageSendParams: MessageSendParams = { userId: 'me', requestBody: { raw } }
        if (params.threadId && messageSendParams.requestBody) {
          messageSendParams.requestBody.threadId = params.threadId
        }

        const { data } = await gmail.users.messages.send(messageSendParams)

        if (data.payload) {
          data.payload = processMessagePart(
            data.payload,
            params.includeBodyHtml
          )
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.TrashMessage].name,
    TOOLS[GmailTool.TrashMessage].description,
    {
      id: z.string().describe("The ID of the message to move to trash")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.trash({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UntrashMessage].name,
    TOOLS[GmailTool.UntrashMessage].description,
    {
      id: z.string().describe("The ID of the message to remove from trash")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.untrash({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetAttachment].name,
    TOOLS[GmailTool.GetAttachment].description,
    {
      messageId: z.string().describe("ID of the message containing the attachment"),
      id: z.string().describe("The ID of the attachment"),
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.messages.attachments.get({ userId: 'me', messageId: params.messageId, id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteThread].name,
    TOOLS[GmailTool.DeleteThread].description,
    {
      id: z.string().describe("The ID of the thread to delete")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.delete({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetThread].name,
    TOOLS[GmailTool.GetThread].description,
    {
      id: z.string().describe("The ID of the thread to retrieve"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.get({ userId: 'me', id: params.id, format: 'full' })

        if (data.messages) {
          data.messages = data.messages.map(message => {
            if (message.payload) {
              message.payload = processMessagePart(message.payload, params.includeBodyHtml)
            }
            return message
          })
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListThreads].name,
    TOOLS[GmailTool.ListThreads].description,
    {
      maxResults: z.number().optional().describe("Maximum number of threads to return"),
      pageToken: z.string().optional().describe("Page token to retrieve a specific page of results"),
      q: z.string().optional().describe("Only return threads matching the specified query"),
      labelIds: z.array(z.string()).optional().describe("Only return threads with labels that match all of the specified label IDs"),
      includeSpamTrash: z.boolean().optional().describe("Include threads from SPAM and TRASH in the results"),
      includeBodyHtml: z.boolean().optional().describe("Whether to include the parsed HTML in the return for each body, excluded by default because they can be excessively large"),
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.list({ userId: 'me', ...params })

        if (data.threads) {
          data.threads = data.threads.map(thread => {
            if (thread.messages) {
              thread.messages = thread.messages.map(message => {
                if (message.payload) {
                  message.payload = processMessagePart(
                    message.payload,
                    params.includeBodyHtml
                  )
                }
                return message
              })
            }
            return thread
          })
        }

        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ModifyThread].name,
    TOOLS[GmailTool.ModifyThread].description,
    {
      id: z.string().describe("The ID of the thread to modify"),
      addLabelIds: z.array(z.string()).optional().describe("A list of label IDs to add to the thread"),
      removeLabelIds: z.array(z.string()).optional().describe("A list of label IDs to remove from the thread")
    },
    async (params) => {
      const { id, ...threadData } = params
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.modify({ userId: 'me', id, requestBody: threadData })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.TrashThread].name,
    TOOLS[GmailTool.TrashThread].description,
    {
      id: z.string().describe("The ID of the thread to move to trash")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.trash({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UntrashThread].name,
    TOOLS[GmailTool.UntrashThread].description,
    {
      id: z.string().describe("The ID of the thread to remove from trash")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.threads.untrash({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetAutoForwarding].name,
    TOOLS[GmailTool.GetAutoForwarding].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.getAutoForwarding({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetImap].name,
    TOOLS[GmailTool.GetImap].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.getImap({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetLanguage].name,
    TOOLS[GmailTool.GetLanguage].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.getLanguage({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetPop].name,
    TOOLS[GmailTool.GetPop].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.getPop({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetVacation].name,
    TOOLS[GmailTool.GetVacation].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.getVacation({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateAutoForwarding].name,
    TOOLS[GmailTool.UpdateAutoForwarding].description,
    {
      enabled: z.boolean().describe("Whether all incoming mail is automatically forwarded to another address"),
      emailAddress: z.string().describe("Email address to which messages should be automatically forwarded"),
      disposition: z.enum(['leaveInInbox', 'archive', 'trash', 'markRead']).describe("The state in which messages should be left after being forwarded")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.updateAutoForwarding({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateImap].name,
    TOOLS[GmailTool.UpdateImap].description,
    {
      enabled: z.boolean().describe("Whether IMAP is enabled for the account"),
      expungeBehavior: z.enum(['archive', 'trash', 'deleteForever']).optional().describe("The action that will be executed on a message when it is marked as deleted and expunged from the last visible IMAP folder"),
      maxFolderSize: z.number().optional().describe("An optional limit on the number of messages that can be accessed through IMAP")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.updateImap({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateLanguage].name,
    TOOLS[GmailTool.UpdateLanguage].description,
    {
      displayLanguage: z.string().describe("The language to display Gmail in, formatted as an RFC 3066 Language Tag")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.updateLanguage({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdatePop].name,
    TOOLS[GmailTool.UpdatePop].description,
    {
      accessWindow: z.enum(['disabled', 'allMail', 'fromNowOn']).describe("The range of messages which are accessible via POP"),
      disposition: z.enum(['archive', 'trash', 'leaveInInbox']).describe("The action that will be executed on a message after it has been fetched via POP")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.updatePop({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateVacation].name,
    TOOLS[GmailTool.UpdateVacation].description,
    {
      enableAutoReply: z.boolean().describe("Whether the vacation responder is enabled"),
      responseSubject: z.string().optional().describe("Optional subject line for the vacation responder auto-reply"),
      responseBodyPlainText: z.string().describe("Response body in plain text format"),
      restrictToContacts: z.boolean().optional().describe("Whether responses are only sent to contacts"),
      restrictToDomain: z.boolean().optional().describe("Whether responses are only sent to users in the same domain"),
      startTime: z.string().optional().describe("Start time for sending auto-replies (epoch ms)"),
      endTime: z.string().optional().describe("End time for sending auto-replies (epoch ms)")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.updateVacation({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.AddDelegate].name,
    TOOLS[GmailTool.AddDelegate].description,
    {
      delegateEmail: z.string().describe("Email address of delegate to add")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.delegates.create({ userId: 'me', requestBody: { delegateEmail: params.delegateEmail } })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.RemoveDelegate].name,
    TOOLS[GmailTool.RemoveDelegate].description,
    {
      delegateEmail: z.string().describe("Email address of delegate to remove")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.delegates.delete({ userId: 'me', delegateEmail: params.delegateEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetDelegate].name,
    TOOLS[GmailTool.GetDelegate].description,
    {
      delegateEmail: z.string().describe("The email address of the delegate to retrieve")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.delegates.get({ userId: 'me', delegateEmail: params.delegateEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListDelegates].name,
    TOOLS[GmailTool.ListDelegates].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.delegates.list({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.CreateFilter].name,
    TOOLS[GmailTool.CreateFilter].description,
    {
      criteria: z.object({
        from: z.string().optional().describe("The sender's display name or email address"),
        to: z.string().optional().describe("The recipient's display name or email address"),
        subject: z.string().optional().describe("Case-insensitive phrase in the message's subject"),
        query: z.string().optional().describe("A Gmail search query that specifies the filter's criteria"),
        negatedQuery: z.string().optional().describe("A Gmail search query that specifies criteria the message must not match"),
        hasAttachment: z.boolean().optional().describe("Whether the message has any attachment"),
        excludeChats: z.boolean().optional().describe("Whether the response should exclude chats"),
        size: z.number().optional().describe("The size of the entire RFC822 message in bytes"),
        sizeComparison: z.enum(['smaller', 'larger']).optional().describe("How the message size in bytes should be in relation to the size field")
      }).describe("Filter criteria"),
      action: z.object({
        addLabelIds: z.array(z.string()).optional().describe("List of labels to add to messages"),
        removeLabelIds: z.array(z.string()).optional().describe("List of labels to remove from messages"),
        forward: z.string().optional().describe("Email address that the message should be forwarded to")
      }).describe("Actions to perform on messages matching the criteria")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.filters.create({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteFilter].name,
    TOOLS[GmailTool.DeleteFilter].description,
    {
      id: z.string().describe("The ID of the filter to be deleted")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.filters.delete({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetFilter].name,
    TOOLS[GmailTool.GetFilter].description,
    {
      id: z.string().describe("The ID of the filter to be fetched")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.filters.get({ userId: 'me', id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListFilters].name,
    TOOLS[GmailTool.ListFilters].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.filters.list({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.CreateForwardingAddress].name,
    TOOLS[GmailTool.CreateForwardingAddress].description,
    {
      forwardingEmail: z.string().describe("An email address to which messages can be forwarded")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.forwardingAddresses.create({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteForwardingAddress].name,
    TOOLS[GmailTool.DeleteForwardingAddress].description,
    {
      forwardingEmail: z.string().describe("The forwarding address to be deleted")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.forwardingAddresses.delete({ userId: 'me', forwardingEmail: params.forwardingEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetForwardingAddress].name,
    TOOLS[GmailTool.GetForwardingAddress].description,
    {
      forwardingEmail: z.string().describe("The forwarding address to be retrieved")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.forwardingAddresses.get({ userId: 'me', forwardingEmail: params.forwardingEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListForwardingAddresses].name,
    TOOLS[GmailTool.ListForwardingAddresses].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.forwardingAddresses.list({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.CreateSendAs].name,
    TOOLS[GmailTool.CreateSendAs].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header"),
      displayName: z.string().optional().describe("A name that appears in the 'From:' header"),
      replyToAddress: z.string().optional().describe("An optional email address that is included in a 'Reply-To:' header"),
      signature: z.string().optional().describe("An optional HTML signature"),
      isPrimary: z.boolean().optional().describe("Whether this address is the primary address"),
      treatAsAlias: z.boolean().optional().describe("Whether Gmail should treat this address as an alias")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.create({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteSendAs].name,
    TOOLS[GmailTool.DeleteSendAs].description,
    {
      sendAsEmail: z.string().describe("The send-as alias to be deleted")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.delete({ userId: 'me', sendAsEmail: params.sendAsEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetSendAs].name,
    TOOLS[GmailTool.GetSendAs].description,
    {
      sendAsEmail: z.string().describe("The send-as alias to be retrieved")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.get({ userId: 'me', sendAsEmail: params.sendAsEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListSendAs].name,
    TOOLS[GmailTool.ListSendAs].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.list({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.PatchSendAs].name,
    TOOLS[GmailTool.PatchSendAs].description,
    {
      sendAsEmail: z.string().describe("The send-as alias to be updated"),
      displayName: z.string().optional().describe("A name that appears in the 'From:' header"),
      replyToAddress: z.string().optional().describe("An optional email address that is included in a 'Reply-To:' header"),
      signature: z.string().optional().describe("An optional HTML signature"),
      isPrimary: z.boolean().optional().describe("Whether this address is the primary address"),
      treatAsAlias: z.boolean().optional().describe("Whether Gmail should treat this address as an alias")
    },
    async (params) => {
      const { sendAsEmail, ...patchData } = params
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.patch({ userId: 'me', sendAsEmail, requestBody: patchData })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.UpdateSendAs].name,
    TOOLS[GmailTool.UpdateSendAs].description,
    {
      sendAsEmail: z.string().describe("The send-as alias to be updated"),
      displayName: z.string().optional().describe("A name that appears in the 'From:' header"),
      replyToAddress: z.string().optional().describe("An optional email address that is included in a 'Reply-To:' header"),
      signature: z.string().optional().describe("An optional HTML signature"),
      isPrimary: z.boolean().optional().describe("Whether this address is the primary address"),
      treatAsAlias: z.boolean().optional().describe("Whether Gmail should treat this address as an alias")
    },
    async (params) => {
      const { sendAsEmail, ...updateData } = params
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.update({ userId: 'me', sendAsEmail, requestBody: updateData })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.VerifySendAs].name,
    TOOLS[GmailTool.VerifySendAs].description,
    {
      sendAsEmail: z.string().describe("The send-as alias to be verified")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.verify({ userId: 'me', sendAsEmail: params.sendAsEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.DeleteSmimeInfo].name,
    TOOLS[GmailTool.DeleteSmimeInfo].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header"),
      id: z.string().describe("The immutable ID for the S/MIME config")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.smimeInfo.delete({ userId: 'me', sendAsEmail: params.sendAsEmail, id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetSmimeInfo].name,
    TOOLS[GmailTool.GetSmimeInfo].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header"),
      id: z.string().describe("The immutable ID for the S/MIME config")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.smimeInfo.get({ userId: 'me', sendAsEmail: params.sendAsEmail, id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.InsertSmimeInfo].name,
    TOOLS[GmailTool.InsertSmimeInfo].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header"),
      encryptedKeyPassword: z.string().describe("Encrypted key password"),
      pkcs12: z.string().describe("PKCS#12 format containing a single private/public key pair and certificate chain")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.smimeInfo.insert({ userId: 'me', sendAsEmail: params.sendAsEmail, requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.ListSmimeInfo].name,
    TOOLS[GmailTool.ListSmimeInfo].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.smimeInfo.list({ userId: 'me', sendAsEmail: params.sendAsEmail })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.SetDefaultSmimeInfo].name,
    TOOLS[GmailTool.SetDefaultSmimeInfo].description,
    {
      sendAsEmail: z.string().describe("The email address that appears in the 'From:' header"),
      id: z.string().describe("The immutable ID for the S/MIME config")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.settings.sendAs.smimeInfo.setDefault({ userId: 'me', sendAsEmail: params.sendAsEmail, id: params.id })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.GetProfile].name,
    TOOLS[GmailTool.GetProfile].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.getProfile({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.WatchMailbox].name,
    TOOLS[GmailTool.WatchMailbox].description,
    {
      topicName: z.string().describe("The name of the Cloud Pub/Sub topic to publish notifications to"),
      labelIds: z.array(z.string()).optional().describe("Label IDs to restrict notifications to"),
      labelFilterAction: z.enum(['include', 'exclude']).optional().describe("Whether to include or exclude the specified labels")
    },
    async (params) => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.watch({ userId: 'me', requestBody: params })
        return formatResponse(data)
      })
    }
  )

  server.tool(TOOLS[GmailTool.StopMailWatch].name,
    TOOLS[GmailTool.StopMailWatch].description,
    {},
    async () => {
      return handleTool(gmail, async (gmail: gmail_v1.Gmail) => {
        const { data } = await gmail.users.stop({ userId: 'me' })
        return formatResponse(data)
      })
    }
  )

  return server.server
}

const buildGmailClient = (accessToken: string): gmail_v1.Gmail => {
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

const sendError = (res: Response, status: number, code: number, message: string) => {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null })
}

const main = async () => {
  const app = express()
  app.use("/mcp", express.json())

  app.post("/mcp", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(res, 401, -32001, "Missing or malformed Authorization header (expected 'Bearer <google_access_token>')")
      return
    }
    const accessToken = authHeader.slice("Bearer ".length).trim()
    if (!accessToken) {
      sendError(res, 401, -32001, "Empty bearer token")
      return
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = createServer({ gmail: buildGmailClient(accessToken) })

    res.on("close", () => {
      transport.close()
      server.close()
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error("Error handling MCP request:", error)
      if (!res.headersSent) sendError(res, 500, -32603, "Internal server error")
    }
  })

  app.get("/mcp", (_req, res) => {
    res.json({ tools: Object.values(TOOLS) })
  })
  app.delete("/mcp", (_req, res) => sendError(res, 405, -32000, "Method Not Allowed (stateless server)"))

  app.listen(PORT, () => {
    console.error(`Gmail MCP server listening on port ${PORT}`)
  })
}

main()
