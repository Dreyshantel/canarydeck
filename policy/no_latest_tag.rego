package main

# Blocks ":latest" (or a bare tag with no version at all), since a
# floating tag makes it impossible to know what is actually running, or
# to roll back to a specific known-good build, both things Project 1's
# canary analysis and Project 2's build integrity work depend on being
# knowable.

deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  endswith(container.image, ":latest")
  msg := sprintf("container '%s' uses the ':latest' tag, pin to a specific version or digest", [container.name])
}

deny[msg] {
  input.kind == "Rollout"
  container := input.spec.template.spec.containers[_]
  endswith(container.image, ":latest")
  msg := sprintf("container '%s' uses the ':latest' tag, pin to a specific version or digest", [container.name])
}
