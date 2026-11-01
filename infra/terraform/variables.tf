# ── Secrets: pass as TF_VAR_* env vars, never in tfvars or git ──
# (The DigitalOcean provider reads DIGITALOCEAN_TOKEN directly.)

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS:Edit on the zone."
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key for transactional email."
  type        = string
  sensitive   = true
}

variable "state_encryption_passphrase" {
  description = "Passphrase for OpenTofu state/plan encryption (min 16 chars). Losing it means losing the state."
  type        = string
  sensitive   = true
}

# ── Settings ──

variable "domain" {
  description = "Apex for the app, e.g. quotes.example.com. Hosts: <domain>, app., admin., api."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone that contains var.domain."
  type        = string
}

variable "digitalocean_region" {
  description = "Droplet region. Changing it replaces the server and its local database."
  type        = string
  default     = "fra1"
}

variable "ssh_public_keys" {
  description = "Public keys for the deploy user: the CI deploy key plus administrator keys."
  type        = list(string)
}

variable "droplet_size" {
  description = "Droplet size (doctl compute size list). Builds run in CI, not on this server."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_backups" {
  description = "Enable paid DigitalOcean Droplet backups. Logical database dumps are also needed."
  type        = bool
  default     = false
}

variable "izaro_user_id" {
  description = "User whose quotes /izaro shows (UUID or legacy integer id). Empty disables the page."
  type        = string
  default     = ""
}

variable "hibp_enabled" {
  type    = bool
  default = true
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "extra_dns_records" {
  description = "Additional records, e.g. Resend's SPF/DKIM/DMARC values once the Resend dashboard shows them."
  type = map(object({
    type     = string
    name     = string
    content  = string
    priority = optional(number)
  }))
  default = {}
}
