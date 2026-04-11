/* build_mflinks.sas — Create mfl2/mfl3 prereqs for tfn_holdings_parallel.sas */

%let year2 = 2024;

proc sort data=mfl.mflink2 nodupkey out=mfl2;
    by wficn fundno rdate;
    where wficn is not null;
run;

data out.mfl2;
    set mfl2;
    by wficn fundno rdate;
    output;
    if last.fundno and year(rdate)=&year2. then do;
        do while(rdate<=intnx('quarter',today(),0,'E'));
            rdate=intnx('quarter',rdate,1,'E');
            output;
        end;
    end;
run;

proc sql;
    create table out.mfl3 as
        select distinct a.*, b.*
        from out.mfl2 a,
        mfl.mflink1 b
        where a.wficn=b.wficn;
quit;

proc sort data=out.mfl3;
    by wficn crsp_fundno rdate;
run;

%put NOTE: mfl2 and mfl3 created successfully;
