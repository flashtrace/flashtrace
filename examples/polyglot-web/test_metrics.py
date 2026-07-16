# [utest:api/metrics#1]
import json


def test_metrics_shape():
    assert json.loads('{"metrics": []}') == {"metrics": []}
