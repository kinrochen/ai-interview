"""Position paging, aggregate statistics and save validation."""
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.models.models import Position, Resume, ResumeStatus, PositionStatus
from app.services.position_service import get_positions_page, get_position_stats


def test_paged_positions_can_reach_records_beyond_first_100(client, db, auth_headers):
    db.add_all([Position(title=f"分页岗位 {i:03}", description="职责", status=PositionStatus.OPEN) for i in range(105)])
    db.commit()
    response = client.get('/api/positions/page?skip=100&limit=10', headers=auth_headers)
    assert response.status_code == 200
    assert response.json()['total'] == 105
    assert len(response.json()['items']) == 5


def test_paging_filters_and_count_match(client, db, auth_headers):
    db.add_all([
        Position(title="前端工程师", description="职责", status=PositionStatus.OPEN),
        Position(title="前端实习生", description="职责", status=PositionStatus.PUBLISHED),
        Position(title="后端工程师", description="职责", status=PositionStatus.PUBLISHED),
    ])
    db.commit()
    response = client.get('/api/positions/page?title=前端&status=published', headers=auth_headers)
    assert response.status_code == 200
    assert response.json()['total'] == 1
    assert response.json()['items'][0]['title'] == '前端实习生'
    # Existing dropdown consumers still receive the original array contract.
    assert isinstance(client.get('/api/positions', headers=auth_headers).json(), list)


@pytest.mark.parametrize('query', ['skip=-1', 'limit=0', 'limit=101', 'status=invalid'])
def test_pagination_rejects_invalid_parameters(client, auth_headers, query):
    assert client.get('/api/positions/page?' + query, headers=auth_headers).status_code == 422


def test_stats_include_ai_and_department_review_states(db, test_position):
    statuses = [ResumeStatus.PENDING_SCREENING, ResumeStatus.PENDING_REVIEW,
                ResumeStatus.PENDING_DEPT_REVIEW, ResumeStatus.PENDING_HR_DECISION,
                ResumeStatus.AUTO_REJECTED_PENDING_REVIEW, ResumeStatus.PENDING_INTERVIEW,
                ResumeStatus.OFFER_ACCEPTED, ResumeStatus.INTERVIEW_FAILED]
    db.add_all([Resume(position_id=test_position.id, candidate_name=f"候选人{i}", status=value) for i, value in enumerate(statuses)])
    db.commit()
    stats = get_position_stats(db, test_position.id)
    assert stats.total_resumes == 8
    assert stats.pending_screening == 5
    assert stats.pending_interview == 1
    assert stats.interview_completed == 2
    assert stats.offer_accepted == 1
    assert stats.rejected == 1


def test_page_statistics_use_a_bounded_number_of_queries(db, test_user):
    db.add_all([Position(title=f"岗位{i}", description="职责", hiring_manager_id=test_user.id) for i in range(20)])
    db.commit()
    queries = []
    def before_execute(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            queries.append(statement)
    event.listen(db.bind, 'before_cursor_execute', before_execute)
    try:
        page = get_positions_page(db, limit=20)
    finally:
        event.remove(db.bind, 'before_cursor_execute', before_execute)
    assert page.total == 20
    assert len(page.items) == 20
    assert all(item.hiring_manager_name == test_user.full_name for item in page.items)
    assert len(queries) == 3


def test_update_rejects_missing_hiring_manager(client, auth_headers, test_position):
    result = client.put(f'/api/positions/{test_position.id}', headers=auth_headers, json={'hiring_manager_id': str(uuid4())})
    assert result.status_code == 400
    assert '不存在' in result.json()['detail']


def test_update_can_clear_hiring_manager(client, auth_headers, test_position, test_user, db):
    test_position.hiring_manager_id = test_user.id
    db.commit()
    result = client.put(f'/api/positions/{test_position.id}', headers=auth_headers, json={'hiring_manager_id': None})
    assert result.status_code == 200
    assert result.json()['hiring_manager_id'] is None


def test_create_rejects_nonpositive_headcount(client, auth_headers):
    result = client.post('/api/positions', headers=auth_headers, json={'title': '岗位', 'description': '职责', 'headcount': 0})
    assert result.status_code == 422
