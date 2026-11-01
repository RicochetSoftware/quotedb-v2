# Plan-only tests with every provider mocked: no real cloud resources or credentials.
mock_provider "digitalocean" {
  mock_resource "digitalocean_droplet" {
    defaults = {
      id           = "123456"
      ipv4_address = "192.0.2.10"
      ipv6_address = "2001:db8::10"
    }
  }
}
mock_provider "cloudflare" {}
mock_provider "random" {
  mock_resource "random_password" {
    defaults = { result = "testPasswordOnly123456789" }
  }
}
mock_provider "tls" {
  mock_resource "tls_private_key" {
    defaults = {
      private_key_openssh = "TEST-ONLY-NOT-A-REAL-PRIVATE-KEY\n"
      public_key_openssh  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly"
    }
  }
}

run "all_hosts_on_one_droplet" {
  command = plan
  variables {
    domain                      = "quotes.elmu.dev"
    cloudflare_api_token        = "test-only"
    cloudflare_zone_id          = "test-zone"
    resend_api_key              = "test-only"
    state_encryption_passphrase = "test-only-passphrase-not-production"
    ssh_public_keys             = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly test"]
  }
  assert {
    condition = (
      toset([for r in cloudflare_dns_record.app : r.name]) == toset([
        "quotes.elmu.dev", "app.quotes.elmu.dev", "admin.quotes.elmu.dev", "api.quotes.elmu.dev"
      ]) &&
      alltrue([for r in cloudflare_dns_record.app : r.content == output.server_ipv4 && !r.proxied]) &&
      length(cloudflare_dns_record.app_ipv6) == 4 &&
      alltrue([for r in cloudflare_dns_record.app_ipv6 : r.content == "2001:db8::10" && !r.proxied])
    )
    error_message = "All four hosts must use the same Droplet with DNS-only A and AAAA records."
  }
  assert {
    condition = (
      strcontains(output.api_env_file, "DATABASE_URL='postgresql://quotedb:testPasswordOnly123456789@postgres:5432/quotedb'") &&
      strcontains(output.api_env_file, "COOKIE_DOMAIN='.quotes.elmu.dev'") &&
      strcontains(output.api_env_file, "HOST='0.0.0.0'") &&
      strcontains(output.postgres_env_file, "POSTGRES_PASSWORD='testPasswordOnly123456789'")
    )
    error_message = "The API and PostgreSQL must share credentials on the Docker network, with the production cookie domain."
  }
}

run "small_droplet_bootstrap" {
  command = plan
  providers = {
    digitalocean = digitalocean
    random       = random
    tls          = tls
  }
  module {
    source = "./modules/digitalocean-backend"
  }
  variables {
    project_name    = "quotedb-test"
    region          = "fra1"
    ssh_public_keys = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly test"]
    api_env         = {}
  }
  assert {
    condition = (
      digitalocean_droplet.app.size == "s-1vcpu-1gb" &&
      digitalocean_droplet.app.region == "fra1" &&
      !digitalocean_droplet.app.backups &&
      yamldecode(digitalocean_droplet.app.user_data).swap.size == 2147483648 &&
      yamldecode(digitalocean_droplet.app.user_data).users[0].ssh_authorized_keys == var.ssh_public_keys
    )
    error_message = "The 1 GB Frankfurt Droplet must boot with swap and the specified deployment SSH keys."
  }
  assert {
    condition = (
      toset([for r in digitalocean_firewall.app.inbound_rule : r.port_range if r.protocol == "tcp"]) == toset(["22", "80", "443"])
    )
    error_message = "The firewall must not expose PostgreSQL or the API container port."
  }
}
