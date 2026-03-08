SUDO ?= sudo

.PHONY: caddy fail2ban deploy

caddy:
	$(SUDO) install -o root -g root -m 0644 caddy/Caddyfile /etc/caddy/Caddyfile
	$(SUDO) bash -lc 'set -a; . /srv/monitoring/caddy/env.prod; set +a; caddy validate --config /etc/caddy/Caddyfile'
	$(SUDO) systemctl reload caddy

fail2ban:
	$(SUDO) install -o root -g root -m 0644 fail2ban/filter.d/caddy-401.conf /etc/fail2ban/filter.d/caddy-401.conf
	$(SUDO) install -o root -g root -m 0644 fail2ban/jail.d/grafana-401.local /etc/fail2ban/jail.d/grafana-401.local
	$(SUDO) systemctl restart fail2ban

deploy: caddy fail2ban
