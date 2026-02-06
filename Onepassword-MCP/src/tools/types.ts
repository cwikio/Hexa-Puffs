// Import the shared StandardResponse type
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";

// Vault list response
export interface VaultListItem {
  id: string;
  name: string;
}

export type ListVaultsResponse = StandardResponse<VaultListItem[]>;

// Item list response
export interface ItemListItem {
  id: string;
  title: string;
  category: string;
  vault: string;
  updated_at: string;
}

export type ListItemsResponse = StandardResponse<ItemListItem[]>;

// Item details response
export interface ItemField {
  label: string;
  type: string;
  value?: string;
  reference: string;
}

export interface ItemDetails {
  id: string;
  title: string;
  category: string;
  vault: string;
  fields: ItemField[];
  created_at: string;
  updated_at: string;
}

export type GetItemResponse = StandardResponse<ItemDetails>;

// Secret read response
export type ReadSecretResponse = StandardResponse<string>;
