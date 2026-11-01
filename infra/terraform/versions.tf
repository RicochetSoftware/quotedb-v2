terraform {
  required_version = ">= 1.8.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.106"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.4"
    }
  }

  # Cloudflare R2 via the S3 backend. Settings live in backend.hcl (gitignored):
  #   tofu init -backend-config=backend.hcl
  backend "s3" {}

  # OpenTofu-only: state and plans contain the DB password, cookie secret and SSH host key, so encrypt them.
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_encryption_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

# Auth: DIGITALOCEAN_TOKEN env var. doctl authentication is separate.
provider "digitalocean" {}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
