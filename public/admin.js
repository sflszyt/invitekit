const $=s=>document.querySelector(s);
const status=$('#admin-status');
async function load(){
  $('#refresh').disabled=true;$('#export').hidden=true;$('#admin-data').hidden=true;
  status.textContent='正在读取已保存的回复…';
  try{
    const response=await fetch('/api/admin/rsvps',{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error(response.status===401||response.status===403?'未获得管理权限。请通过获授权的 Cloudflare Access 账户登录。':'管理入口尚未配置或暂不可用，请稍后重试。');
    const data=await response.json();
    for(const [id,key] of [['adults-total','adults'],['children-total','children'],['guests-total','guests'],['replies-total','replies']])$('#'+id).textContent=String(data.totals[key]);
    $('#reply-summary').textContent=`出席 ${data.totals.attendingParties} 份邀请 · 缺席 ${data.totals.declinedParties} 份邀请`;
    const fragment=document.createDocumentFragment();
    for(const reply of data.replies){
      const row=document.createElement('tr');
      const values=[reply.name,reply.attendance==='yes'?'出席':'缺席',reply.adultCount,reply.childCount,reply.partySize,new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(reply.updatedAt*1000))];
      for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}
      fragment.append(row);
    }
    $('#replies-body').replaceChildren(fragment);$('#empty-state').hidden=data.replies.length>0;
    status.textContent=data.preview?'仅本机开发预览 · 当前显示的是此电脑上的测试数据库。正式管理入口需要受保护的账户。':'管理权限已验证 · 仅显示已成功保存的回复。请妥善保管导出的名单。';
    $('#admin-data').hidden=false;$('#export').hidden=false;
  }catch(error){status.textContent=error.message||'连接中断，请重试。';}
  finally{$('#refresh').disabled=false;}
}
$('#refresh').addEventListener('click',load);load();
