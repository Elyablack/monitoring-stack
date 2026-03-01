SUDO ?= sudo

.PHONY: caddy fail2ban deploy

caddy:
	$(SUDO) install -o root -g root -m 0644 caddy/Caddyfile /etc/caddy/Caddyfile
	$(SUDO) caddy validate --config /etc/caddy/Caddyfile
	$(SUDO) systemctl reload caddy

fail2ban:
	$(SUDO) install -o root -g root -m 0644 fail2ban/filter.d/caddy-404.conf /etc/fail2ban/filter.d/caddy-404.conf
	$(SUDO) install -o root -g root -m 0644 fail2ban/jail.d/caddy-404.local /etc/fail2ban/jail.d/caddy-404.local
	$(SUDO) systemctl reload fail2ban

deploy: caddy fail2ban
