resource "random_password" "postgres" {
  length  = 48
  special = false
}

locals {
  database_url = "postgresql://quotedb:${random_password.postgres.result}@postgres:5432/quotedb"
  api_env = merge(var.api_env, {
    HOST         = "0.0.0.0"
    PORT         = "8080"
    DATABASE_URL = local.database_url
  })
}

resource "tls_private_key" "host" {
  algorithm = "ED25519"
}

resource "digitalocean_droplet" "app" {
  name       = var.project_name
  region     = var.region
  size       = var.server_size
  image      = var.server_image
  ipv6       = true
  monitoring = true
  backups    = var.backups

  # The deploy user's authorized keys are installed by cloud-init; no account-wide
  # SSH key resources are created or replaced.
  user_data = templatefile("${path.module}/cloud-init.yaml", {
    deploy_user      = var.deploy_user
    ssh_public_keys  = var.ssh_public_keys
    host_key_private = tls_private_key.host.private_key_openssh
    host_key_public  = trimspace(tls_private_key.host.public_key_openssh)
  })

  lifecycle {
    # PostgreSQL lives on this disk. Rebuilds need a deliberate backup/restore procedure.
    prevent_destroy = true
    ignore_changes  = [user_data]
  }
}

resource "digitalocean_firewall" "app" {
  name        = "${var.project_name}-web"
  droplet_ids = [digitalocean_droplet.app.id]

  dynamic "inbound_rule" {
    for_each = ["22", "80", "443"]
    content {
      protocol         = "tcp"
      port_range       = inbound_rule.value
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }
  inbound_rule {
    protocol         = "udp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  dynamic "outbound_rule" {
    for_each = ["tcp", "udp"]
    content {
      protocol              = outbound_rule.value
      port_range            = "1-65535"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    }
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
