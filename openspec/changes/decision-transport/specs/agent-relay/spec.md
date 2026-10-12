# Spec Delta

## MODIFIED Requirements


### Requirement: The relay never blocks the host

The relay SHALL NOT wait for the companion to acknowledge a delivery, and SHALL NOT wait for
any response. It SHALL exit once the payload has been delivered.

This guarantee belongs to the relay program specifically. Where a second program is
installed as a hook in order to carry a decision back, that program is the one that waits,
and the guarantee this requirement states is not extended to it — it is stated separately,
in the capability that governs the wait, so that weakening it is a visible act rather than
a drift.

#### Scenario: Companion is slow

- **WHEN** the companion takes a long time to read what was delivered
- **THEN** the relay does not wait for it

#### Scenario: Relay waits for nothing

- **WHEN** the relay has delivered a payload
- **THEN** it exits without waiting for a reply, an acknowledgement, or a timeout

#### Scenario: The relay is unchanged by a second program existing

- **WHEN** a second program is installed as a hook alongside the relay
- **THEN** the relay's own behaviour and its own sources are unaffected, and the relay still exits without waiting
