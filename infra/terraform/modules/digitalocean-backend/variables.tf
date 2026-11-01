variable "project_name" {
  type = string
}

variable "region" {
  type = string
}

variable "server_size" {
  type    = string
  default = "s-1vcpu-1gb"
}

variable "backups" {
  type    = bool
  default = false
}

variable "server_image" {
  type    = string
  default = "ubuntu-24-04-x64"
}

variable "deploy_user" {
  type    = string
  default = "deploy"
}

variable "ssh_public_keys" {
  type = list(string)
  validation {
    condition     = length(var.ssh_public_keys) > 0 && alltrue([for key in var.ssh_public_keys : can(regex("^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+", key))])
    error_message = "Supply at least one valid OpenSSH ed25519 or RSA public key."
  }
}

variable "api_env" {
  description = "Application environment; the module adds HOST, PORT, and DATABASE_URL."
  type        = map(string)
  sensitive   = true
}
