"""Stocks, flows and services are accounted for once each."""
import numpy as np

from ai_controls import compute
from types import SimpleNamespace


def test_no_negative_quantities(base_run):
    for res in base_run.results.values():
        for name in ("C_us", "C_cn", "S_us", "S_cn", "Q_dom", "dom_add", "imports", "remote", "W", "D"):
            assert np.all(res.series[name] >= 0), name


def test_additions_never_exceed_demand(base_run):
    for res in base_run.results.values():
        s = res.series
        assert np.all(s["dom_add"] + s["imports"] <= s["D"] * (1 + 1e-9))
        assert np.all(s["dom_add"] <= s["Q_dom"] * (1 + 1e-9))


def test_stock_accounting_excludes_rentals(base_run, base_cfg):
    """C_cn(t+1) = (1 - dep) C_cn(t) + domestic additions + imports. Rented remote compute
    never enters the hardware stock, so a one-year rental leaves nothing behind."""
    dep = base_cfg.params["dep"].value
    for res in base_run.results.values():
        s = res.series
        lhs = s["C_cn"][1:]
        rhs = (1 - dep) * s["C_cn"][:-1] + s["dom_add"][:-1] + s["imports"][:-1]
        assert np.allclose(lhs, rhs, rtol=1e-9)


def test_rental_adds_services_only_this_year():
    P = SimpleNamespace(util=0.6, train_share=0.3, cloud_train_discount=0.3)
    zero = np.zeros(1)
    one = np.ones(1)
    with_rent = compute.services(one * 100, one * 2, one * 8, one * 5, one, one, one, 0.5, P)
    without = compute.services(one * 100, one * 2, one * 8, zero, one, one, one, 0.5, P)
    assert np.isclose(with_rent[1] - without[1], 0.6 * 5)            # China gains services
    assert np.isclose(without[0] - with_rent[0], 0.6 * 0.5 * 5)      # US loses the displaced share


def test_power_cannot_create_compute_without_chips():
    P = SimpleNamespace(util=0.6, train_share=0.3, cloud_train_discount=0.3)
    z = np.zeros(1)
    huge_power = compute.power_factor(z, np.ones(1) * 1e9)
    out = compute.services(z, z, z, z, np.ones(1), huge_power, huge_power, 0.5, P)
    assert all(np.all(v == 0) for v in out)
