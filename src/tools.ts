export enum GmailTool {
  // Drafts
  CreateDraft = "create_draft",
  DeleteDraft = "delete_draft",
  GetDraft = "get_draft",
  ListDrafts = "list_drafts",
  SendDraft = "send_draft",

  // Labels
  CreateLabel = "create_label",
  DeleteLabel = "delete_label",
  GetLabel = "get_label",
  ListLabels = "list_labels",
  PatchLabel = "patch_label",
  UpdateLabel = "update_label",

  // Messages
  BatchDeleteMessages = "batch_delete_messages",
  BatchModifyMessages = "batch_modify_messages",
  DeleteMessage = "delete_message",
  GetMessage = "get_message",
  ListMessages = "list_messages",
  ModifyMessage = "modify_message",
  SendMessage = "send_message",
  TrashMessage = "trash_message",
  UntrashMessage = "untrash_message",
  GetAttachment = "get_attachment",

  // Threads
  DeleteThread = "delete_thread",
  GetThread = "get_thread",
  ListThreads = "list_threads",
  ModifyThread = "modify_thread",
  TrashThread = "trash_thread",
  UntrashThread = "untrash_thread",

  // Settings
  GetAutoForwarding = "get_auto_forwarding",
  GetImap = "get_imap",
  GetLanguage = "get_language",
  GetPop = "get_pop",
  GetVacation = "get_vacation",
  UpdateAutoForwarding = "update_auto_forwarding",
  UpdateImap = "update_imap",
  UpdateLanguage = "update_language",
  UpdatePop = "update_pop",
  UpdateVacation = "update_vacation",

  // Delegates
  AddDelegate = "add_delegate",
  RemoveDelegate = "remove_delegate",
  GetDelegate = "get_delegate",
  ListDelegates = "list_delegates",

  // Filters
  CreateFilter = "create_filter",
  DeleteFilter = "delete_filter",
  GetFilter = "get_filter",
  ListFilters = "list_filters",

  // Forwarding addresses
  CreateForwardingAddress = "create_forwarding_address",
  DeleteForwardingAddress = "delete_forwarding_address",
  GetForwardingAddress = "get_forwarding_address",
  ListForwardingAddresses = "list_forwarding_addresses",

  // Send-as aliases
  CreateSendAs = "create_send_as",
  DeleteSendAs = "delete_send_as",
  GetSendAs = "get_send_as",
  ListSendAs = "list_send_as",
  PatchSendAs = "patch_send_as",
  UpdateSendAs = "update_send_as",
  VerifySendAs = "verify_send_as",

  // S/MIME info
  DeleteSmimeInfo = "delete_smime_info",
  GetSmimeInfo = "get_smime_info",
  InsertSmimeInfo = "insert_smime_info",
  ListSmimeInfo = "list_smime_info",
  SetDefaultSmimeInfo = "set_default_smime_info",

  // Profile / mailbox watch
  GetProfile = "get_profile",
  WatchMailbox = "watch_mailbox",
  StopMailWatch = "stop_mail_watch"
}

export interface ToolDefinition {
  name: GmailTool
  description: string
}

export const TOOLS: Record<GmailTool, ToolDefinition> = {
  [GmailTool.CreateDraft]: {
    name: GmailTool.CreateDraft,
    description: "Create a draft email in Gmail. Note the mechanics of the raw parameter."
  },
  [GmailTool.DeleteDraft]: {
    name: GmailTool.DeleteDraft,
    description: "Delete a draft"
  },
  [GmailTool.GetDraft]: {
    name: GmailTool.GetDraft,
    description: "Get a specific draft by ID"
  },
  [GmailTool.ListDrafts]: {
    name: GmailTool.ListDrafts,
    description: "List drafts in the user's mailbox"
  },
  [GmailTool.SendDraft]: {
    name: GmailTool.SendDraft,
    description: "Send an existing draft"
  },

  [GmailTool.CreateLabel]: {
    name: GmailTool.CreateLabel,
    description: "Create a new label"
  },
  [GmailTool.DeleteLabel]: {
    name: GmailTool.DeleteLabel,
    description: "Delete a label"
  },
  [GmailTool.GetLabel]: {
    name: GmailTool.GetLabel,
    description: "Get a specific label by ID"
  },
  [GmailTool.ListLabels]: {
    name: GmailTool.ListLabels,
    description: "List all labels in the user's mailbox"
  },
  [GmailTool.PatchLabel]: {
    name: GmailTool.PatchLabel,
    description: "Patch an existing label (partial update)"
  },
  [GmailTool.UpdateLabel]: {
    name: GmailTool.UpdateLabel,
    description: "Update an existing label"
  },

  [GmailTool.BatchDeleteMessages]: {
    name: GmailTool.BatchDeleteMessages,
    description: "Delete multiple messages"
  },
  [GmailTool.BatchModifyMessages]: {
    name: GmailTool.BatchModifyMessages,
    description: "Modify the labels on multiple messages"
  },
  [GmailTool.DeleteMessage]: {
    name: GmailTool.DeleteMessage,
    description: "Immediately and permanently delete a message"
  },
  [GmailTool.GetMessage]: {
    name: GmailTool.GetMessage,
    description: "Get a specific message by ID with format options"
  },
  [GmailTool.ListMessages]: {
    name: GmailTool.ListMessages,
    description: "List messages in the user's mailbox with optional filtering"
  },
  [GmailTool.ModifyMessage]: {
    name: GmailTool.ModifyMessage,
    description: "Modify the labels on a message"
  },
  [GmailTool.SendMessage]: {
    name: GmailTool.SendMessage,
    description: "Send an email message to specified recipients. Note the mechanics of the raw parameter."
  },
  [GmailTool.TrashMessage]: {
    name: GmailTool.TrashMessage,
    description: "Move a message to the trash"
  },
  [GmailTool.UntrashMessage]: {
    name: GmailTool.UntrashMessage,
    description: "Remove a message from the trash"
  },
  [GmailTool.GetAttachment]: {
    name: GmailTool.GetAttachment,
    description: "Get a message attachment"
  },

  [GmailTool.DeleteThread]: {
    name: GmailTool.DeleteThread,
    description: "Delete a thread"
  },
  [GmailTool.GetThread]: {
    name: GmailTool.GetThread,
    description: "Get a specific thread by ID"
  },
  [GmailTool.ListThreads]: {
    name: GmailTool.ListThreads,
    description: "List threads in the user's mailbox"
  },
  [GmailTool.ModifyThread]: {
    name: GmailTool.ModifyThread,
    description: "Modify the labels applied to a thread"
  },
  [GmailTool.TrashThread]: {
    name: GmailTool.TrashThread,
    description: "Move a thread to the trash"
  },
  [GmailTool.UntrashThread]: {
    name: GmailTool.UntrashThread,
    description: "Remove a thread from the trash"
  },

  [GmailTool.GetAutoForwarding]: {
    name: GmailTool.GetAutoForwarding,
    description: "Gets auto-forwarding settings"
  },
  [GmailTool.GetImap]: {
    name: GmailTool.GetImap,
    description: "Gets IMAP settings"
  },
  [GmailTool.GetLanguage]: {
    name: GmailTool.GetLanguage,
    description: "Gets language settings"
  },
  [GmailTool.GetPop]: {
    name: GmailTool.GetPop,
    description: "Gets POP settings"
  },
  [GmailTool.GetVacation]: {
    name: GmailTool.GetVacation,
    description: "Get vacation responder settings"
  },
  [GmailTool.UpdateAutoForwarding]: {
    name: GmailTool.UpdateAutoForwarding,
    description: "Updates automatic forwarding settings"
  },
  [GmailTool.UpdateImap]: {
    name: GmailTool.UpdateImap,
    description: "Updates IMAP settings"
  },
  [GmailTool.UpdateLanguage]: {
    name: GmailTool.UpdateLanguage,
    description: "Updates language settings"
  },
  [GmailTool.UpdatePop]: {
    name: GmailTool.UpdatePop,
    description: "Updates POP settings"
  },
  [GmailTool.UpdateVacation]: {
    name: GmailTool.UpdateVacation,
    description: "Update vacation responder settings"
  },

  [GmailTool.AddDelegate]: {
    name: GmailTool.AddDelegate,
    description: "Adds a delegate to the specified account"
  },
  [GmailTool.RemoveDelegate]: {
    name: GmailTool.RemoveDelegate,
    description: "Removes the specified delegate"
  },
  [GmailTool.GetDelegate]: {
    name: GmailTool.GetDelegate,
    description: "Gets the specified delegate"
  },
  [GmailTool.ListDelegates]: {
    name: GmailTool.ListDelegates,
    description: "Lists the delegates for the specified account"
  },

  [GmailTool.CreateFilter]: {
    name: GmailTool.CreateFilter,
    description: "Creates a filter"
  },
  [GmailTool.DeleteFilter]: {
    name: GmailTool.DeleteFilter,
    description: "Deletes a filter"
  },
  [GmailTool.GetFilter]: {
    name: GmailTool.GetFilter,
    description: "Gets a filter"
  },
  [GmailTool.ListFilters]: {
    name: GmailTool.ListFilters,
    description: "Lists the message filters of a Gmail user"
  },

  [GmailTool.CreateForwardingAddress]: {
    name: GmailTool.CreateForwardingAddress,
    description: "Creates a forwarding address"
  },
  [GmailTool.DeleteForwardingAddress]: {
    name: GmailTool.DeleteForwardingAddress,
    description: "Deletes the specified forwarding address"
  },
  [GmailTool.GetForwardingAddress]: {
    name: GmailTool.GetForwardingAddress,
    description: "Gets the specified forwarding address"
  },
  [GmailTool.ListForwardingAddresses]: {
    name: GmailTool.ListForwardingAddresses,
    description: "Lists the forwarding addresses for the specified account"
  },

  [GmailTool.CreateSendAs]: {
    name: GmailTool.CreateSendAs,
    description: "Creates a custom send-as alias"
  },
  [GmailTool.DeleteSendAs]: {
    name: GmailTool.DeleteSendAs,
    description: "Deletes the specified send-as alias"
  },
  [GmailTool.GetSendAs]: {
    name: GmailTool.GetSendAs,
    description: "Gets the specified send-as alias"
  },
  [GmailTool.ListSendAs]: {
    name: GmailTool.ListSendAs,
    description: "Lists the send-as aliases for the specified account"
  },
  [GmailTool.PatchSendAs]: {
    name: GmailTool.PatchSendAs,
    description: "Patches the specified send-as alias"
  },
  [GmailTool.UpdateSendAs]: {
    name: GmailTool.UpdateSendAs,
    description: "Updates a send-as alias"
  },
  [GmailTool.VerifySendAs]: {
    name: GmailTool.VerifySendAs,
    description: "Sends a verification email to the specified send-as alias"
  },

  [GmailTool.DeleteSmimeInfo]: {
    name: GmailTool.DeleteSmimeInfo,
    description: "Deletes the specified S/MIME config for the specified send-as alias"
  },
  [GmailTool.GetSmimeInfo]: {
    name: GmailTool.GetSmimeInfo,
    description: "Gets the specified S/MIME config for the specified send-as alias"
  },
  [GmailTool.InsertSmimeInfo]: {
    name: GmailTool.InsertSmimeInfo,
    description: "Insert (upload) the given S/MIME config for the specified send-as alias"
  },
  [GmailTool.ListSmimeInfo]: {
    name: GmailTool.ListSmimeInfo,
    description: "Lists S/MIME configs for the specified send-as alias"
  },
  [GmailTool.SetDefaultSmimeInfo]: {
    name: GmailTool.SetDefaultSmimeInfo,
    description: "Sets the default S/MIME config for the specified send-as alias"
  },

  [GmailTool.GetProfile]: {
    name: GmailTool.GetProfile,
    description: "Get the current user's Gmail profile"
  },
  [GmailTool.WatchMailbox]: {
    name: GmailTool.WatchMailbox,
    description: "Watch for changes to the user's mailbox"
  },
  [GmailTool.StopMailWatch]: {
    name: GmailTool.StopMailWatch,
    description: "Stop receiving push notifications for the given user mailbox"
  }
}
