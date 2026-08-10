package main

# Blocks any Kubernetes manifest that would run a container as root.
# This is a hard pipeline gate (see .github/workflows/ci.yml), not a
# linter warning, a deploy that violates this fails the build.

deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.securityContext.runAsNonRoot == true
  msg := sprintf("container '%s' does not set securityContext.runAsNonRoot: true", [container.name])
}

deny[msg] {
  input.kind == "Rollout"
  container := input.spec.template.spec.containers[_]
  not container.securityContext.runAsNonRoot == true
  msg := sprintf("container '%s' does not set securityContext.runAsNonRoot: true", [container.name])
}
