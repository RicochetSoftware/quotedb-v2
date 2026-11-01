terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
    }
    random = {
      source = "hashicorp/random"
    }
    tls = {
      source = "hashicorp/tls"
    }
  }
}
